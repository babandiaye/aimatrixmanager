"""Conversion texte LLM → HTML Matrix avec math LaTeX.

Objectif : que Element rende `\frac{a}{b}` comme une vraie fraction KaTeX
et non comme du texte brut. Matrix supporte MSC2191 : un HTML avec
l'attribut `data-mx-maths="<LATEX>"` déclenche le rendu KaTeX côté client
(sous réserve du flag `feature_latex_maths` dans le config.json d'Element).

## Pipeline

Piège classique : si on passe directement le markdown+LaTeX à mistune, il
mange les caractères LaTeX (`_`, `*`, `^`) et corrompt les formules avant
qu'on ait pu les repérer. Le pattern robuste :

1. **Extraire** blocs et inline LaTeX → remplacer par des placeholders
   ASCII neutres (`§§MB0§§`, `§§MI0§§`, …) que mistune traite comme du
   texte pur (pas de règle markdown sur `§`).
2. **Convertir markdown** → HTML avec mistune (gère paragraphes, gras,
   italiques, code fences, listes — tout ce qui a du sens pour un LLM).
3. **Réinjecter** chaque placeholder par le HTML Matrix approprié :
   - inline `\(...\)`, `$...$` → `<span data-mx-maths="...">...</span>`
   - block  `\[...\]`, `$$...$$` → `<div data-mx-maths="...">...</div>`
   Les blocs remplacent leur `<p>` englobant pour rester au niveau block.

## Sécurité

Le LaTeX est HTML-escapé avant injection (`data-mx-maths="..."` ET
`<code>...</code>`). Fallback intégré côté clients qui ne supportent
pas KaTeX : le `<code>` interne affiche le LaTeX brut lisible.

## Fallback total

Si la conversion échoue (regex bizarre, mistune plante), `latex_to_mx`
retourne `None`. L'appelant envoie alors juste le body texte brut,
comportement inchangé.
"""
from __future__ import annotations

import re
from html import escape
from typing import Optional

import mistune

# Blocs multi-lignes : \[...\] ou $$...$$
# DOTALL pour que `.` matche les newlines à l'intérieur d'un bloc.
_MATH_BLOCK = re.compile(
    r"\\\[(.+?)\\\]|\$\$(.+?)\$\$",
    re.DOTALL,
)

# Inline : \(...\) ou $...$ (mais pas $$)
# Le `\$...\$` interdit un `$$` adjacent via lookarounds pour éviter que
# `$$formule$$` matche partiellement en inline (l'ordre extract-blocs-
# avant-inlines évite déjà ce cas, mais ceinture + bretelles).
_MATH_INLINE = re.compile(
    r"\\\((.+?)\\\)"
    r"|"
    r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)"
)

# Placeholders : `§` (U+00A7) n'a aucun rôle markdown et est extrêmement
# rare dans un texte français normal, encore plus dans les réponses LLM.
# En cas de collision improbable, la conversion échoue proprement (le
# placeholder final ne se réinjecte pas → l'appelant tombe en texte brut
# via le fallback global).
_PH_BLOCK = "§§MB{i}§§"
_PH_INLINE = "§§MI{i}§§"


def _wrap_inline(latex: str) -> str:
    e = escape(latex.strip(), quote=True)
    return f'<span data-mx-maths="{e}"><code>{e}</code></span>'


def _wrap_block(latex: str) -> str:
    e = escape(latex.strip(), quote=True)
    return f'<div data-mx-maths="{e}"><code>{e}</code></div>'


def latex_to_mx(text: str) -> Optional[str]:
    """Convertit du texte markdown+LaTeX en HTML Matrix `data-mx-maths`.

    Retourne `None` si aucun rendu enrichi n'apporte de valeur (pas de
    formule ET pas de balise markdown détectable) ou si la conversion
    échoue. Dans les deux cas, l'appelant utilise juste `body` brut.
    """
    if not text:
        return None

    try:
        blocks: list[str] = []
        inlines: list[str] = []

        def stash_block(m: re.Match) -> str:
            latex = m.group(1) if m.group(1) is not None else m.group(2)
            blocks.append(latex)
            return _PH_BLOCK.format(i=len(blocks) - 1)

        def stash_inline(m: re.Match) -> str:
            latex = m.group(1) if m.group(1) is not None else m.group(2)
            inlines.append(latex)
            return _PH_INLINE.format(i=len(inlines) - 1)

        # 1. Extraire les blocs (multi-lignes, avant les inline pour ne pas
        #    confondre `$$...$$` avec `$...$`).
        cleaned = _MATH_BLOCK.sub(stash_block, text)
        # 2. Extraire les inline restantes.
        cleaned = _MATH_INLINE.sub(stash_inline, cleaned)

        # Rien à convertir en riche ? Court-circuit : le texte brut suffit.
        if not blocks and not inlines and not _has_markdown(cleaned):
            return None

        # 3. Convertir le reste (sans LaTeX) en HTML via mistune.
        # `escape=True` : mistune HTML-échappe le contenu, protège contre
        # les balises injectées par le LLM (pas d'`<script>` dans nos msgs).
        html = mistune.html(cleaned)

        # 4. Réinjecter les blocs : un bloc était sur sa propre ligne, donc
        # mistune l'a probablement enveloppé dans `<p>…</p>`. On cible le
        # `<p>` complet pour rester "block-level" en sortie.
        for i, latex in enumerate(blocks):
            ph = _PH_BLOCK.format(i=i)
            wrapped = _wrap_block(latex)
            # Cas 1 : le placeholder est seul dans un paragraphe.
            html = html.replace(f"<p>{ph}</p>", wrapped)
            # Cas 2 : reste au milieu d'un paragraphe (rare avec `\[...\]`
            # sur ligne à part, mais possible si le LLM l'inline). On le
            # laisse en <div> imbriqué — HTML pas parfait mais valide, et
            # Element rend quand même.
            html = html.replace(ph, wrapped)

        # 5. Réinjecter les inline : simple remplacement de string.
        for i, latex in enumerate(inlines):
            html = html.replace(_PH_INLINE.format(i=i), _wrap_inline(latex))

        return html
    except Exception:
        # Fallback silencieux — l'appelant utilise le body texte brut.
        return None


# Heuristique bon marché : détecte les marqueurs markdown les plus courants
# pour décider s'il vaut la peine d'envoyer un formatted_body. Un simple
# "salut, ça va ?" sans emphase ne mérite pas de HTML.
_MD_HINT = re.compile(r"(\*\*|__|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\[.+?\]\(.+?\))", re.MULTILINE)


def _has_markdown(text: str) -> bool:
    return bool(_MD_HINT.search(text))
