/**
 * Illustration décorative en bas à droite de /mes-cours : petit ordinateur
 * avec graphique + robot IA + bulle de conversation. Purement décoratif,
 * ne bloque aucun clic (`pointer-events-none`), s'affiche en dessous du
 * contenu utile (`z-0`). Masqué sur mobile (<lg) pour ne pas empiéter
 * sur le contenu.
 *
 * Style : lignes/formes simples, cohérent avec la palette primary/muted.
 * SVG statique — pas de dépendance externe.
 */
export function DashboardIllustration({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute bottom-0 right-0 hidden lg:block ${className}`}
    >
      <svg
        viewBox="0 0 340 220"
        width="340"
        height="220"
        className="text-primary"
      >
        {/* Petit robot en bas-gauche */}
        <g transform="translate(20, 130)">
          {/* Antenne */}
          <line
            x1="30"
            y1="5"
            x2="30"
            y2="0"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="30" cy="0" r="2.5" fill="currentColor" />
          {/* Tête */}
          <rect
            x="12"
            y="6"
            width="36"
            height="28"
            rx="8"
            fill="currentColor"
            opacity="0.15"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {/* Yeux */}
          <circle cx="22" cy="20" r="2.5" fill="currentColor" />
          <circle cx="38" cy="20" r="2.5" fill="currentColor" />
          {/* Bouche */}
          <line
            x1="26"
            y1="27"
            x2="34"
            y2="27"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Corps */}
          <rect
            x="8"
            y="36"
            width="44"
            height="30"
            rx="6"
            fill="currentColor"
            opacity="0.15"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {/* Petit voyant central */}
          <circle cx="30" cy="51" r="3" fill="currentColor" opacity="0.4" />
        </g>

        {/* Bulle de chat (au-dessus du robot) */}
        <g transform="translate(85, 120)">
          <rect
            x="0"
            y="0"
            width="60"
            height="26"
            rx="13"
            fill="currentColor"
            opacity="0.08"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity="0.3"
          />
          <circle cx="15" cy="13" r="2" fill="currentColor" opacity="0.5" />
          <circle cx="25" cy="13" r="2" fill="currentColor" opacity="0.5" />
          <circle cx="35" cy="13" r="2" fill="currentColor" opacity="0.5" />
          <path
            d="M 15 26 L 12 32 L 20 26 Z"
            fill="currentColor"
            opacity="0.08"
          />
        </g>

        {/* Ordinateur avec graph — élément principal à droite */}
        <g transform="translate(140, 40)">
          {/* Écran */}
          <rect
            x="0"
            y="0"
            width="170"
            height="110"
            rx="8"
            fill="currentColor"
            opacity="0.06"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {/* Barre supérieure fenêtre */}
          <rect
            x="0"
            y="0"
            width="170"
            height="14"
            rx="8"
            fill="currentColor"
            opacity="0.12"
          />
          <circle cx="10" cy="7" r="2" fill="currentColor" opacity="0.4" />
          <circle cx="18" cy="7" r="2" fill="currentColor" opacity="0.4" />
          <circle cx="26" cy="7" r="2" fill="currentColor" opacity="0.4" />

          {/* Graph en ligne */}
          <polyline
            points="15,90 40,65 65,75 90,45 115,55 140,30 160,40"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Points de données */}
          <circle cx="40" cy="65" r="2.5" fill="currentColor" />
          <circle cx="90" cy="45" r="2.5" fill="currentColor" />
          <circle cx="140" cy="30" r="2.5" fill="currentColor" />

          {/* Camembert coloré à droite */}
          <g transform="translate(115, 65)">
            <circle
              cx="18"
              cy="18"
              r="18"
              fill="currentColor"
              opacity="0.15"
            />
            <path
              d="M 18 18 L 18 0 A 18 18 0 0 1 33.6 27 Z"
              fill="currentColor"
              opacity="0.55"
            />
            <path
              d="M 18 18 L 33.6 27 A 18 18 0 0 1 4 26 Z"
              fill="currentColor"
              opacity="0.35"
            />
          </g>

          {/* Pied de l'ordinateur */}
          <rect
            x="60"
            y="112"
            width="50"
            height="4"
            rx="2"
            fill="currentColor"
            opacity="0.3"
          />
          <rect
            x="45"
            y="116"
            width="80"
            height="3"
            rx="1.5"
            fill="currentColor"
            opacity="0.3"
          />
        </g>

        {/* Icône chat en bas de l'écran (petit décor) */}
        <g transform="translate(150, 165)">
          <rect
            x="0"
            y="0"
            width="30"
            height="26"
            rx="6"
            fill="currentColor"
            opacity="0.15"
          />
          <path
            d="M 5 26 L 8 32 L 12 26 Z"
            fill="currentColor"
            opacity="0.15"
          />
        </g>

        {/* Petits points décoratifs */}
        <g fill="currentColor" opacity="0.25">
          <circle cx="325" cy="30" r="2" />
          <circle cx="315" cy="50" r="1.5" />
          <circle cx="330" cy="70" r="1.5" />
          <circle cx="320" cy="180" r="2" />
          <circle cx="305" cy="195" r="1.5" />
        </g>
      </svg>
    </div>
  );
}
