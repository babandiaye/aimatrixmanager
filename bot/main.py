"""
Bot multi-agents Matrix — runtime aibotmanager.

Lit la table `Agent` (status=ENABLED) et lance N clients matrix-nio en parallèle.
Chaque agent ne répond que :
  - dans ses rooms assignées (RoomAgent enabled=true)
  - quand il est mentionné (@<slug> ou son MXID/displayname)

Logs des conversations dans `AuditLog`.
"""
import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from nio import (
    AsyncClient,
    AsyncClientConfig,
    InviteMemberEvent,
    KeysQueryResponse,
    KeysUploadResponse,
    MatrixRoom,
    MegolmEvent,
    RoomMemberEvent,
    RoomMessageText,
)

import db
import llm
import rag
import rag_tools
from crypto_utils import decrypt

load_dotenv()

# ── Configuration globale ─────────────────────────────────────────────────────
MATRIX_HOMESERVER = os.getenv("MATRIX_HOMESERVER", "http://127.0.0.1:8008")
SYNAPSE_ADMIN_TOKEN = os.getenv("SYNAPSE_ADMIN_TOKEN", "")
STORE_ROOT = os.getenv("STORE_PATH", "/app/store")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
MAX_HISTORY = int(os.getenv("MAX_HISTORY", "20"))

# ── Auto-rejoin sur kick ──────────────────────────────────────────────────────
# Cooldown entre 2 tentatives de rejoin pour éviter de spammer Synapse
# en cas de bagarre avec un admin qui kick en boucle. Au-delà de
# REJOIN_MAX_FAILS échecs consécutifs, on désactive l'assignation
# (RoomAgent.enabled=false) — l'admin du salon a clairement décidé que
# le bot n'y avait pas sa place, on lâche prise.
REJOIN_COOLDOWN_SEC = int(os.getenv("REJOIN_COOLDOWN_SEC", "300"))   # 5 min
REJOIN_MAX_FAILS = int(os.getenv("REJOIN_MAX_FAILS", "3"))

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("aibotmanager")


# ══════════════════════════════════════════════════════════════════════════════
# AgentRunner — un par agent
# ══════════════════════════════════════════════════════════════════════════════

class AgentRunner:
    def __init__(self, row: db.AgentRow):
        self.row = row
        self.localpart = row.matrix_user_id.split(":", 1)[0].lstrip("@")
        self.store_path = os.path.join(STORE_ROOT, self.row.slug)
        Path(self.store_path).mkdir(parents=True, exist_ok=True)
        self.client: Optional[AsyncClient] = None
        # Historique court par room (clé = matrix_room_id)
        self.history: dict[str, list] = {}
        self.log = log.getChild(self.row.slug)

    async def whoami(self, access_token: str) -> Optional[str]:
        """Récupère le device_id si on ne l'a pas en DB (premier démarrage d'un agent récent)."""
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.get(
                f"{MATRIX_HOMESERVER}/_matrix/client/v3/account/whoami",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if r.status_code != 200:
                self.log.error(f"whoami: {r.status_code} {r.text}")
                return None
            return r.json().get("device_id")

    async def setup(self) -> bool:
        access_token = decrypt(self.row.matrix_access_token_enc)
        device_id = self.row.matrix_device_id
        if not device_id:
            self.log.info("Pas de device_id en DB — récupération via whoami")
            device_id = await self.whoami(access_token)
            if not device_id:
                self.log.error("Impossible d'obtenir le device_id")
                return False
            await db.save_device_id(self.row.id, device_id)
            self.log.info(f"device_id persisté : {device_id}")

        nio_config = AsyncClientConfig(
            store_sync_tokens=True,
            encryption_enabled=True,
        )
        self.client = AsyncClient(
            homeserver=MATRIX_HOMESERVER,
            user=self.row.matrix_user_id,
            device_id=device_id,
            store_path=self.store_path,
            config=nio_config,
        )
        self.client.restore_login(
            user_id=self.row.matrix_user_id,
            device_id=device_id,
            access_token=access_token,
        )
        self.log.info(f"✅ Session restaurée — {self.row.matrix_user_id} (device={device_id})")
        return True

    # ── Détection mention ──────────────────────────────────────────────────────
    def is_mentioned(self, event, body: str) -> bool:
        # 1. m.mentions.user_ids (MSC3952)
        try:
            mentions = (event.source or {}).get("content", {}).get("m.mentions", {})
            if self.row.matrix_user_id in (mentions.get("user_ids") or []):
                return True
        except Exception:
            pass
        # 2. body contient le slug ou le MXID
        low = body.lower()
        if f"@{self.localpart}".lower() in low:
            return True
        if self.row.matrix_user_id.lower() in low:
            return True
        # 3. body contient le display name
        if self.row.name.lower() in low:
            return True
        # 4. formatted_body avec pill
        try:
            formatted = (event.source or {}).get("content", {}).get("formatted_body") or ""
            if self.row.matrix_user_id in formatted:
                return True
        except Exception:
            pass
        return False

    def strip_mention(self, body: str) -> str:
        cleaned = body
        for pattern in (
            self.row.matrix_user_id,
            f"@{self.localpart}",
            self.row.name,
        ):
            if not pattern:
                continue
            cleaned = re.sub(
                r"\s*" + re.escape(pattern) + r"\s*[:,]?\s*",
                " ",
                cleaned,
                flags=re.IGNORECASE,
            )
        return cleaned.strip()

    def is_dm(self, room: MatrixRoom) -> bool:
        return len(room.users) <= 2

    # ── Indicateur "is typing" Matrix ────────────────────────────────────────
    # Le client Matrix (Element, Cinny, …) anime nativement « X écrit… » avec
    # 3 points animés. On l'active dès qu'on commence à réfléchir/streamer et
    # on le rafraîchit toutes les ~10s pour ne pas timeout (Synapse expire le
    # typing après 15s par défaut).
    async def _typing_loop(self, room_id: str, stop: asyncio.Event):
        try:
            while not stop.is_set():
                try:
                    await self.client.room_typing(
                        room_id, typing_state=True, timeout=15000
                    )
                except Exception as e:
                    self.log.debug(f"room_typing: {e}")
                try:
                    await asyncio.wait_for(stop.wait(), timeout=10)
                    break  # stop event reçu
                except asyncio.TimeoutError:
                    continue  # 10s passées → on refresh le typing
        finally:
            # Garantie : on coupe l'indicateur quel que soit l'état de sortie
            try:
                await self.client.room_typing(
                    room_id, typing_state=False, timeout=0
                )
            except Exception:
                pass

    # ── Animation « pulse » dans le message lui-même ────────────────────────
    # Les emojis Matrix sont statiques : pour simuler une animation type
    # « Claude réfléchit… qui clignote », on édite le placeholder en boucle
    # en cyclant à travers plusieurs états (emoji + points). L'animation
    # s'arrête dès que le premier token du LLM arrive (signalé par `stop`).
    # Intervalle 650 ms = 1.5 edit/s → bien sous le rate-limit Synapse.
    PULSE_FRAMES = (
        "💭 Réfléchit",
        "💭 Réfléchit .",
        "💭 Réfléchit . .",
        "💭 Réfléchit . . .",
        "✨ Réfléchit . . .",
        "💭 Réfléchit . .",
        "💭 Réfléchit .",
    )
    PULSE_INTERVAL = 0.65

    async def _pulse_loop(
        self, room_id: str, event_id: str, stop: asyncio.Event
    ):
        i = 0
        try:
            while not stop.is_set():
                try:
                    await asyncio.wait_for(
                        stop.wait(), timeout=self.PULSE_INTERVAL
                    )
                    break  # stop reçu pendant l'attente
                except asyncio.TimeoutError:
                    pass
                if stop.is_set():
                    break
                i = (i + 1) % len(self.PULSE_FRAMES)
                try:
                    await self._edit_message(
                        room_id, event_id, self.PULSE_FRAMES[i]
                    )
                except Exception as e:
                    self.log.debug(f"pulse edit: {e}")
        except Exception as e:
            self.log.debug(f"pulse loop: {e}")

    # ── Envoi ─────────────────────────────────────────────────────────────────
    async def _ensure_megolm(self, room_id: str):
        """Partage la session Megolm si la room est chiffrée. No-op sinon."""
        room = self.client.rooms.get(room_id)
        if room and room.encrypted:
            try:
                await self.client.share_group_session(
                    room_id=room_id, ignore_unverified_devices=True
                )
            except Exception as e:
                self.log.warning(f"share_group_session: {e}")

    async def send(self, room_id: str, text: str) -> Optional[str]:
        try:
            await self._ensure_megolm(room_id)
            resp = await self.client.room_send(
                room_id=room_id,
                message_type="m.room.message",
                content={"msgtype": "m.text", "body": text},
                ignore_unverified_devices=True,
            )
            return getattr(resp, "event_id", None)
        except Exception as e:
            self.log.error(f"Erreur envoi {room_id}: {e}")
            return None

    async def _edit_message(self, room_id: str, event_id: str, new_text: str):
        """Édit un message via m.replace (MSC2676)."""
        await self._ensure_megolm(room_id)
        content = {
            "msgtype": "m.text",
            "body": f"* {new_text}",  # fallback display pour clients non-edit
            "m.new_content": {"msgtype": "m.text", "body": new_text},
            "m.relates_to": {
                "rel_type": "m.replace",
                "event_id": event_id,
            },
        }
        try:
            await self.client.room_send(
                room_id=room_id,
                message_type="m.room.message",
                content=content,
                ignore_unverified_devices=True,
            )
        except Exception as e:
            self.log.warning(f"Édit message {event_id[:20]}: {e}")

    # ── LLM streaming ─────────────────────────────────────────────────────────
    # Throttle : on n'édite pas plus d'une fois par seconde et seulement si
    # >100 char ont été ajoutés depuis la dernière édition. Évite de spammer
    # les serveurs Synapse (rate-limit) et les clients (re-render à chaque
    # event). Seuils réglables via STREAM_EDIT_INTERVAL / STREAM_EDIT_DELTA.
    # Matrix limite la fréquence des messages côté Synapse (rc_message ~0.2/s
    # en régime stable, burst 10). 400ms / 25 chars donne du token-par-token
    # quasi instantané sans risquer le 429.
    STREAM_EDIT_INTERVAL = float(os.getenv("STREAM_EDIT_INTERVAL", "0.4"))
    STREAM_EDIT_DELTA = int(os.getenv("STREAM_EDIT_DELTA", "25"))

    async def ask_llm_streaming(
        self,
        room_id: str,
        question: str,
        course_db_id: Optional[str] = None,
        rag_enabled: bool = False,
    ) -> tuple[str, dict]:
        """Place un placeholder, stream la réponse LLM en éditant
        progressivement, puis retourne (texte_final, usage).

        Si `rag_enabled` et `course_db_id` sont set, on fait du RAG : embed
        la question, retrouve les K chunks les plus proches, injecte dans le
        system prompt pour ce tour. Failsafe : si retrieval foire, on tombe
        en mode normal sans planter."""
        history = self.history.setdefault(room_id, [])
        history.append({"role": "user", "content": question})

        # 0. Démarre l'indicateur « is typing » Matrix — Element anime
        # nativement « X écrit… » avec 3 points animés. La task se coupe
        # toujours via le `finally` en bas de la fonction.
        stop_typing = asyncio.Event()
        typing_task = asyncio.create_task(
            self._typing_loop(room_id, stop_typing)
        )

        # 1. Placeholder visible immédiatement (le texte sera remplacé par la
        # réponse réelle au fil du streaming ; l'animation est portée par le
        # typing indicator côté Matrix + pulse interne au message).
        placeholder_id = await self.send(room_id, "💭 Réfléchit")
        if not placeholder_id:
            # Synapse n'a pas accepté l'envoi — on tombe en mode bloquant
            stop_typing.set()
            try:
                await typing_task
            except Exception:
                pass
            answer, usage = await llm.call(self.row, history, MAX_HISTORY)
            await self.send(room_id, answer)
            history.append({"role": "assistant", "content": answer})
            return answer, usage

        # 1.1 Démarre l'animation « pulse » dans le message lui-même.
        # Tournera tant qu'aucun token n'est arrivé (pulse_stop.set() au
        # premier chunk). Garantit que l'utilisateur voit que ça bosse même
        # si le LLM met 3-5s avant le premier token (cas Ollama).
        pulse_stop = asyncio.Event()
        pulse_task = asyncio.create_task(
            self._pulse_loop(room_id, placeholder_id, pulse_stop)
        )

        async def stop_pulse_if_needed():
            """Coupe l'animation pulse une seule fois, au premier token."""
            if not pulse_stop.is_set():
                pulse_stop.set()
                try:
                    await pulse_task
                except Exception:
                    pass

        # 1.5 Décision RAG : 3 modes possibles
        #   - tool-mode : provider=ANTHROPIC + RAG enabled → function calling
        #     (Claude décide quand search_course / get_chapter)
        #   - naive RAG : provider=OLLAMA + RAG enabled → top-K injecté
        #   - no-RAG : pas de cours lié ou reindex désactivé → comportement
        #     classique (juste le system_prompt de base)
        use_tools = (
            rag_enabled
            and course_db_id
            and self.row.provider == "ANTHROPIC"
        )
        system_override = None
        if rag_enabled and course_db_id and not use_tools:
            try:
                ctx = await rag.retrieve_context(course_db_id, question)
                if ctx:
                    system_override = rag.build_system_prompt_with_context(
                        self.row.system_prompt, ctx
                    )
                    self.log.info(
                        f"RAG naïf : contexte injecté ({len(ctx)} chars)"
                    )
            except Exception as e:
                self.log.warning(f"RAG retrieval failed (fallback no-RAG): {e}")

        buffer = ""
        last_edit_t = time.monotonic()
        last_edit_len = 0
        usage: dict = {}

        try:
            if use_tools:
                # Tool-mode (Anthropic) : Claude décide d'utiliser les tools.
                async def dispatcher(name: str, input_: dict) -> str:
                    return await rag_tools.dispatch(name, input_, course_db_id)

                tool_system = rag_tools.system_prompt_for_tools(
                    self.row.system_prompt
                )
                self.log.info(f"RAG tool-mode pour {room_id[:25]}")
                async for kind, payload, u in llm.stream_anthropic_with_tools(
                    self.row,
                    history,
                    MAX_HISTORY,
                    rag_tools.TOOL_DEFINITIONS,
                    tool_system,
                    dispatcher,
                ):
                    if kind == "text":
                        if payload:
                            await stop_pulse_if_needed()
                        buffer += payload
                    elif kind == "tool":
                        await stop_pulse_if_needed()
                        # Indicateur visuel pendant l'exécution du tool
                        self.log.info(f"tool_use: {payload}")
                        marker = (
                            f"\n\n_🔍 Consultation : {payload}…_\n\n"
                            if buffer
                            else f"_🔍 Consultation : {payload}…_\n\n"
                        )
                        await self._edit_message(
                            room_id, placeholder_id, buffer + marker
                        )
                        last_edit_t = time.monotonic()
                        last_edit_len = len(buffer)
                        continue
                    elif kind == "done":
                        usage = u or {}
                        break

                    # Throttle (text mode)
                    now = time.monotonic()
                    if buffer and (
                        now - last_edit_t >= self.STREAM_EDIT_INTERVAL
                        or len(buffer) - last_edit_len >= self.STREAM_EDIT_DELTA
                    ):
                        await self._edit_message(room_id, placeholder_id, buffer)
                        last_edit_t = now
                        last_edit_len = len(buffer)
            else:
                async for chunk, u in llm.stream_call(
                    self.row,
                    history,
                    MAX_HISTORY,
                    system_override=system_override,
                ):
                    if chunk:
                        await stop_pulse_if_needed()
                        buffer += chunk
                    if u is not None:
                        usage = u
                    now = time.monotonic()
                    if buffer and (
                        now - last_edit_t >= self.STREAM_EDIT_INTERVAL
                        or len(buffer) - last_edit_len >= self.STREAM_EDIT_DELTA
                    ):
                        await self._edit_message(room_id, placeholder_id, buffer)
                        self.log.info(
                            f"stream edit @ {len(buffer)} chars for {room_id[:25]}"
                        )
                        last_edit_t = now
                        last_edit_len = len(buffer)
        except Exception as e:
            self.log.error(f"Streaming LLM ({self.row.provider}) : {e}")
            # Fallback : édit avec un message d'erreur si on n'a rien streamé
            if not buffer:
                buffer = "❌ Désolé, je rencontre un problème technique."
        finally:
            # Coupe l'animation « pulse » (au cas où aucun token n'est arrivé,
            # ex: erreur LLM avant le premier chunk).
            await stop_pulse_if_needed()
            # Coupe l'indicateur "is typing" — Element retire l'animation des
            # 3 points dans tous les cas (succès, erreur, exception).
            stop_typing.set()
            try:
                await typing_task
            except Exception:
                pass

        # Édit final — toujours envoyé pour garantir le contenu complet,
        # même si la dernière édition throttle l'avait sauté.
        if buffer:
            await self._edit_message(room_id, placeholder_id, buffer)

        history.append({"role": "assistant", "content": buffer})
        # Purge mémoire
        if len(history) > MAX_HISTORY * 2:
            del history[: len(history) - MAX_HISTORY * 2]
        return buffer, usage

    # ── Pipeline message ──────────────────────────────────────────────────────
    async def handle_text(self, room: MatrixRoom, event: RoomMessageText):
        if event.sender == self.row.matrix_user_id:
            return
        body = (event.body or "").strip()
        if not body:
            return

        # 1. La room est-elle assignée à cet agent et active ?
        ra = await db.get_room_assignment(self.row.id, room.room_id)
        if not ra:
            return  # pas pour cet agent
        if not ra["enabled"]:
            return

        # 2. DM = toujours répondre, groupe = mention requise
        in_dm = self.is_dm(room)
        if not in_dm and not self.is_mentioned(event, body):
            return
        if not in_dm:
            body = self.strip_mention(body)
            if not body:
                return

        self.log.info(
            f"{event.sender} → {room.room_id[:25]} : {body[:80]}"
        )

        t0 = time.monotonic()
        answer = None
        usage = {}
        err = None
        try:
            # Streaming + RAG : si la room est liée à un cours Moodle avec
            # reindexEnabled, on retrieve d'abord les chunks pertinents.
            answer, usage = await self.ask_llm_streaming(
                room.room_id,
                body,
                course_db_id=ra.get("moodleCourseId"),
                rag_enabled=bool(ra.get("rag_enabled")),
            )
        except Exception as e:
            err = str(e)
            answer = "❌ Désolé, je rencontre un problème technique."
            await self.send(room.room_id, answer)
        latency_ms = int((time.monotonic() - t0) * 1000)

        # Audit
        try:
            await db.insert_audit_log(
                room_pk=ra["room_id"],
                agent_id=self.row.id,
                matrix_event_id=event.event_id,
                sender_mxid=event.sender,
                user_message=body,
                agent_response=answer,
                latency_ms=latency_ms,
                error=err,
                **usage,
            )
        except Exception as e:
            self.log.warning(f"Audit log fail : {e}")

    async def on_text(self, room: MatrixRoom, event: RoomMessageText):
        await self.handle_text(room, event)

    async def on_megolm(self, room: MatrixRoom, event: MegolmEvent):
        if event.sender == self.row.matrix_user_id:
            return
        try:
            decrypted = await self.client.decrypt_event(event)
        except Exception as e:
            self.log.warning(f"Déchiffrement E2EE : {e}")
            return
        if isinstance(decrypted, RoomMessageText):
            await self.handle_text(room, decrypted)

    async def on_invite(self, room: MatrixRoom, event: InviteMemberEvent):
        if event.state_key != self.row.matrix_user_id:
            return
        self.log.info(f"Invitation reçue → {room.room_id}")
        await self.client.join(room.room_id)

    # ── Auto-rejoin sur kick ─────────────────────────────────────────────────
    # Quand le bot perd son membership (kick admin), Synapse pousse un event
    # `m.room.member` avec state_key=<MXID du bot> et membership=leave. Si le
    # sender est ≠ du bot lui-même, c'est un kick. On consulte alors la DB
    # pour décider si on rejoint (RoomAgent.enabled + autoRejoinOnKick + cooldown).
    async def _rejoin_via_admin(self, room_id: str) -> bool:
        """Rejoint la room via l'API Synapse Admin (le client lui-même ne peut
        pas car il n'est plus membre). Nécessite SYNAPSE_ADMIN_TOKEN.
        """
        if not SYNAPSE_ADMIN_TOKEN:
            self.log.error("SYNAPSE_ADMIN_TOKEN manquant — rejoin impossible")
            return False
        url = f"{MATRIX_HOMESERVER}/_synapse/admin/v1/join/{room_id}"
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                r = await http.post(
                    url,
                    headers={"Authorization": f"Bearer {SYNAPSE_ADMIN_TOKEN}"},
                    json={"user_id": self.row.matrix_user_id},
                )
                if r.status_code == 200:
                    return True
                self.log.warning(
                    f"rejoin admin {room_id}: {r.status_code} {r.text[:200]}"
                )
                return False
        except Exception as e:
            self.log.warning(f"rejoin admin {room_id}: {e}")
            return False

    async def _attempt_rejoin(self, matrix_room_id: str, reason: str) -> None:
        """Tente un rejoin si la policy l'autorise et que le cooldown est passé.

        Implémentation atomique : `claim_rejoin_attempt` fait le check policy
        + cooldown + lock en un seul UPDATE atomique. Si ça renvoie None,
        c'est qu'on n'a pas le slot (assignation off, autoRejoin off, ou
        cooldown encore actif) — on skip silencieusement.

        Appelé depuis 2 endroits :
          - `on_member_change` (kick observé en live)
          - `_reconcile_membership_at_boot` (kick survenu hors-ligne)
        """
        claim = await db.claim_rejoin_attempt(
            self.row.id, matrix_room_id, REJOIN_COOLDOWN_SEC
        )
        if claim is None:
            self.log.debug(
                f"[{reason}] rejoin skip {matrix_room_id[:25]} "
                f"(policy off ou cooldown actif)"
            )
            return

        self.log.info(
            f"[{reason}] tentative rejoin {matrix_room_id[:25]}…"
        )
        success = await self._rejoin_via_admin(matrix_room_id)
        fail_count = await db.record_rejoin_result(claim["id"], success)

        if success:
            self.log.info(f"✅ Rejoin OK {matrix_room_id[:25]}")
            return

        self.log.warning(
            f"❌ Rejoin échec ({fail_count}/{REJOIN_MAX_FAILS}) "
            f"{matrix_room_id[:25]}"
        )
        if fail_count >= REJOIN_MAX_FAILS:
            self.log.warning(
                f"Plafond d'échecs atteint — désactivation de l'assignation "
                f"{matrix_room_id[:25]}"
            )
            await db.disable_room_agent(claim["id"])
            try:
                await db.insert_system_audit(
                    room_agent_id=claim["id"],
                    agent_id=self.row.id,
                    user_message=(
                        f"Assignation désactivée automatiquement après "
                        f"{fail_count} tentatives de rejoin échouées "
                        f"(salon {matrix_room_id})."
                    ),
                    error="auto-disabled-rejoin",
                )
            except Exception as e:
                self.log.warning(f"Audit auto-disable : {e}")

    async def on_member_change(self, room: MatrixRoom, event: RoomMemberEvent):
        # On ne traite que les events qui concernent CET agent.
        if event.state_key != self.row.matrix_user_id:
            return
        # On ne réagit qu'à une transition vers "leave" — ban est définitif,
        # invite/join sont gérés ailleurs.
        if event.membership != "leave":
            return
        # Self-leave (parti volontairement via la lib) : pas un kick.
        if event.sender == self.row.matrix_user_id:
            return
        # Si l'event précédent était "ban", Matrix garde l'utilisateur dehors
        # tant que le ban n'est pas levé — inutile d'essayer.
        if event.prev_membership == "ban":
            self.log.info(f"Bot banni de {room.room_id[:25]} — pas de rejoin")
            return

        self.log.warning(
            f"Kické de {room.room_id[:25]} par {event.sender}"
        )
        await self._attempt_rejoin(room.room_id, reason="kick-live")

    async def _reconcile_membership_at_boot(self) -> None:
        """Au démarrage, compare les rooms assignées en DB avec celles où le
        client est effectivement membre. Pour les divergences (rooms perdues
        pendant que le bot était hors ligne), on tente un rejoin. Le cooldown
        atomique évite de spammer si l'auto-désactivation s'est déjà
        déclenchée juste avant le redémarrage.
        """
        try:
            assigned = await db.list_assigned_matrix_rooms(self.row.id)
        except Exception as e:
            self.log.warning(f"Reconcile boot — liste DB : {e}")
            return

        joined = set(self.client.rooms.keys()) if self.client else set()
        missing = [rid for rid in assigned if rid not in joined]
        if not missing:
            self.log.info(
                f"Reconcile boot : {len(assigned)} room(s) assignée(s), "
                "toutes présentes côté Matrix"
            )
            return

        self.log.warning(
            f"Reconcile boot : {len(missing)}/{len(assigned)} room(s) "
            f"manquante(s) — tentative de rejoin"
        )
        # Sérialisé exprès : on ne veut pas DDOS Synapse au démarrage d'un
        # agent qui aurait perdu des dizaines de rooms d'un coup.
        for rid in missing:
            await self._attempt_rejoin(rid, reason="boot-recovery")

    async def keys_loop(self):
        await asyncio.sleep(15)
        while True:
            try:
                if self.client.should_upload_keys:
                    await self.client.keys_upload()
                if self.client.should_query_keys:
                    await self.client.keys_query()
            except Exception as e:
                self.log.warning(f"keys_loop : {e}")
            await asyncio.sleep(300)

    async def heartbeat_loop(self):
        """Met à jour Agent.lastHeartbeatAt toutes les 30s pour le dashboard."""
        # Premier ping immédiat
        try:
            await db.update_heartbeat(self.row.id)
        except Exception as e:
            self.log.warning(f"heartbeat init : {e}")
        while True:
            await asyncio.sleep(30)
            try:
                await db.update_heartbeat(self.row.id)
            except Exception as e:
                self.log.warning(f"heartbeat : {e}")

    async def run(self):
        if not await self.setup():
            return
        try:
            await self.client.set_displayname(self.row.name)
        except Exception:
            pass

        self.log.info("Sync initiale...")
        await self.client.sync(timeout=10000, full_state=True)
        if self.client.should_upload_keys:
            await self.client.keys_upload()
        if self.client.should_query_keys:
            await self.client.keys_query()

        self.client.add_event_callback(self.on_text, RoomMessageText)
        self.client.add_event_callback(self.on_megolm, MegolmEvent)
        self.client.add_event_callback(self.on_invite, InviteMemberEvent)
        self.client.add_event_callback(self.on_member_change, RoomMemberEvent)

        # Reconciliation membership : si des kicks ont eu lieu pendant que
        # cet agent était hors-ligne, le callback on_member_change n'aura
        # pas été déclenché. On compare DB ↔ Matrix après le sync initial
        # et on rattrape les divergences via `_attempt_rejoin`.
        await self._reconcile_membership_at_boot()

        asyncio.create_task(self.keys_loop())
        asyncio.create_task(self.heartbeat_loop())
        self.log.info(f"🚀 {self.row.slug} prêt")
        try:
            await self.client.sync_forever(timeout=30000, full_state=True)
        finally:
            await self.client.close()


# ══════════════════════════════════════════════════════════════════════════════
# Reconcile — sync DB ↔ runners en cours (toutes les 60s)
# ══════════════════════════════════════════════════════════════════════════════

RECONCILE_INTERVAL = int(os.getenv("RECONCILE_INTERVAL", "60"))


async def _stop_runner(runner: "AgentRunner", task: asyncio.Task) -> None:
    if not task.done():
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout=5)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        except Exception:
            pass
    if runner.client:
        try:
            await runner.client.close()
        except Exception:
            pass


# Champs hot-reloadables sans relancer la session Matrix (juste swap row).
_HOT_RELOAD_FIELDS = (
    "system_prompt",
    "model",
    "max_tokens",
    "temperature",
    "provider",
    "name",
)

# Champs qui IMPOSENT un restart du runner (nouvelle session Matrix). Ces
# champs changent typiquement lors d'un rotateAgentToken — le nouveau
# accessToken invalide l'ancien côté Synapse, le runner doit réinitialiser
# sa session matrix-nio avec les nouvelles creds.
_RESTART_FIELDS = (
    "matrix_access_token_enc",
    "matrix_device_id",
)


def _config_changed(old: db.AgentRow, new: db.AgentRow) -> list[str]:
    return [f for f in _HOT_RELOAD_FIELDS if getattr(old, f) != getattr(new, f)]


def _credentials_changed(old: db.AgentRow, new: db.AgentRow) -> list[str]:
    return [f for f in _RESTART_FIELDS if getattr(old, f) != getattr(new, f)]


async def reconcile_runners(
    runners: dict[str, tuple["AgentRunner", asyncio.Task]],
) -> None:
    """Aligne les runners en cours avec la liste DB des agents ENABLED."""
    enabled = await db.list_enabled_agents()
    enabled_ids = {a.id for a in enabled}

    # 1. Nettoyage des tasks qui ont planté
    for aid in list(runners.keys()):
        runner, task = runners[aid]
        if task.done():
            log.warning(
                f"Runner {runner.row.slug} a terminé inopinément, retiré du pool"
            )
            del runners[aid]

    # 2. Stopper les runners dont l'agent n'est plus ENABLED
    for aid in list(runners.keys()):
        if aid not in enabled_ids:
            runner, task = runners[aid]
            log.info(f"⏹️  Arrêt runner {runner.row.slug} (plus ENABLED)")
            await _stop_runner(runner, task)
            del runners[aid]

    # 3. Démarrer les runners pour les nouveaux agents
    for agent in enabled:
        if agent.id not in runners:
            log.info(f"▶️  Démarrage runner pour {agent.slug}")
            runner = AgentRunner(agent)
            task = asyncio.create_task(runner.run(), name=agent.slug)
            runners[agent.id] = (runner, task)
            continue

        # 4. Detect credential change (rotateAgentToken) → full restart.
        # Le nouveau accessToken a invalidé l'ancien côté Synapse, donc le
        # runner courant va commencer à recevoir des 401. On stoppe + redémarre
        # avec les nouvelles creds — la nouvelle session Matrix uploadera le
        # nouveau device_keys, ce qui débloque la signature côté UI.
        runner, task = runners[agent.id]
        cred_diff = _credentials_changed(runner.row, agent)
        if cred_diff:
            log.info(
                f"🔄 Restart runner {agent.slug} — credentials changés "
                f"({', '.join(cred_diff)}). L'ancienne session Matrix est invalidée."
            )
            await _stop_runner(runner, task)
            new_runner = AgentRunner(agent)
            new_task = asyncio.create_task(new_runner.run(), name=agent.slug)
            runners[agent.id] = (new_runner, new_task)
            continue

        # 5. Hot-reload de config — si systemPrompt, model, temp, etc. ont
        # changé en DB, on swap le row in-place sans tuer la session Matrix.
        # Le prochain message utilisera la nouvelle config. L'historique de
        # conversation est préservé (utile pour ne pas perturber l'utilisateur).
        diff = _config_changed(runner.row, agent)
        if diff:
            log.info(
                f"⚙️  Reload config {agent.slug} — champs modifiés : {', '.join(diff)}"
            )
            runner.row = agent


async def reconcile_loop(
    runners: dict[str, tuple["AgentRunner", asyncio.Task]],
) -> None:
    """Boucle de fond : reconcile toutes les RECONCILE_INTERVAL secondes."""
    while True:
        await asyncio.sleep(RECONCILE_INTERVAL)
        try:
            await reconcile_runners(runners)
        except Exception as e:
            log.warning(f"reconcile_loop : {e}")


# ══════════════════════════════════════════════════════════════════════════════
# Main — orchestrateur
# ══════════════════════════════════════════════════════════════════════════════

async def main():
    if not os.getenv("DATABASE_URL"):
        log.error("DATABASE_URL non défini")
        sys.exit(1)
    if not os.getenv("WS_TOKEN_ENCRYPTION_KEY"):
        log.error("WS_TOKEN_ENCRYPTION_KEY non défini")
        sys.exit(1)
    # Au moins un provider doit être configuré
    if not os.getenv("ANTHROPIC_API_KEY") and not os.getenv("OLLAMA_API_KEY"):
        log.error("Aucun provider LLM configuré (ANTHROPIC_API_KEY ou OLLAMA_API_KEY)")
        sys.exit(1)

    Path(STORE_ROOT).mkdir(parents=True, exist_ok=True)

    agents = await db.list_enabled_agents()
    log.info(
        f"📋 {len(agents)} agent(s) ENABLED — démarrage initial "
        f"(reconcile chaque {RECONCILE_INTERVAL}s)"
    )

    # Pool partagé : agent.id → (runner, task)
    runners: dict[str, tuple[AgentRunner, asyncio.Task]] = {}
    for agent in agents:
        runner = AgentRunner(agent)
        task = asyncio.create_task(runner.run(), name=agent.slug)
        runners[agent.id] = (runner, task)

    # Boucle de reconciliation en background — démarre toujours,
    # même si la liste initiale est vide (peut être peuplée plus tard via UI).
    reconcile_task = asyncio.create_task(reconcile_loop(runners), name="reconcile")

    try:
        # On attend "indéfiniment" — les tasks runners vivent sous-jacentes.
        # Si tous les runners terminent, le reconcile_loop continue à attendre
        # et redémarrera dès qu'on créera un agent.
        await reconcile_task
    except KeyboardInterrupt:
        log.info("Arrêt demandé")
    except Exception as e:
        log.error(f"Erreur fatale : {e}")


if __name__ == "__main__":
    asyncio.run(main())
