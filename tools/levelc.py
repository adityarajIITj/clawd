"""
CLAWD: The Spark Odyssey — level compiler & linter.

Reads hand-authored level descriptions (levels/*.toml), expands the authoring
generators (paths, spirals, spark patterns, decor scattering), resolves
styles into colours, then runs a reachability lint using the same movement
constants as the Rust character controller. Emits compact JSON for the
runtime.

    python tools/levelc.py <levels_dir> <out_dir>
"""
from __future__ import annotations

import json
import math
import random
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import tomllib
from collections import deque
from pathlib import Path

# ---- mirrored from native/rust/src/lib.rs ----------------------------------
GRAVITY = 38.0
FALL_MULT = 1.18
MAX_SPEED = 9.0
JUMP_V = 14.0
DJUMP_V = 12.5
P_RADIUS = 0.45
DASH_BONUS = 2.6  # conservative extra reach from the air dash

QUEST_IDS = {"all_sparks", "tokens", "no_hurt", "par", "stomp_all", "crates"}


def hexc(h: str) -> list[float]:
    h = h.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)]


# Island / block material styles: top, side, rock
STYLES: dict[str, dict[str, list[float]]] = {
    "meadow":   {"top": hexc("8fbf5a"), "side": hexc("b9875a"), "rock": hexc("7d6a5c")},
    "meadow2":  {"top": hexc("a8c95f"), "side": hexc("c49468"), "rock": hexc("8a7462")},
    "jungle":   {"top": hexc("4fae6e"), "side": hexc("8c6a4f"), "rock": hexc("5d6b6a")},
    "mossy":    {"top": hexc("6fbf7a"), "side": hexc("7c8a86"), "rock": hexc("5a6670")},
    "sand":     {"top": hexc("f0c987"), "side": hexc("e0a066"), "rock": hexc("c27a52")},
    "sandstone":{"top": hexc("f2b880"), "side": hexc("d9895b"), "rock": hexc("b0603f")},
    "crystal":  {"top": hexc("62b4e0"), "side": hexc("5a5fb8"), "rock": hexc("3a3470")},
    "violet":   {"top": hexc("b48ae6"), "side": hexc("6a4fa8"), "rock": hexc("3b2a66")},
    "obsidian": {"top": hexc("3a3440"), "side": hexc("2a2530"), "rock": hexc("1c1820")},
    "gold":     {"top": hexc("f2c45a"), "side": hexc("c98f2e"), "rock": hexc("8a5a20")},
    "stone":    {"top": hexc("d8d2c4"), "side": hexc("a8a294"), "rock": hexc("807a70")},
    "wood":     {"top": hexc("c98a55"), "side": hexc("a0673d"), "rock": hexc("7a4b2a")},
    "terracotta":{"top": hexc("e08a63"), "side": hexc("d97757"), "rock": hexc("a8553a")},
    "ghat":     {"top": hexc("6fae5a"), "side": hexc("6a6a66"), "rock": hexc("4a4c4e")},
    "fort":     {"top": hexc("8a9a7a"), "side": hexc("707276"), "rock": hexc("54565a")},
    "laterite": {"top": hexc("c86a4a"), "side": hexc("b4553a"), "rock": hexc("8a3f2c")},
    "beach":    {"top": hexc("f2d9a8"), "side": hexc("c4643f"), "rock": hexc("963f2c")},
    "lakeshore":{"top": hexc("4f8a5a"), "side": hexc("8a5a44"), "rock": hexc("5a3a34")},
    "lotus":    {"top": hexc("f2a6c0"), "side": hexc("5f9a5a"), "rock": hexc("3f6a3f")},
    "alpine":   {"top": hexc("7aa85a"), "side": hexc("8a8478"), "rock": hexc("5e5a56")},
    "slate":    {"top": hexc("9aa0a8"), "side": hexc("6a6e78"), "rock": hexc("4a4e58")},
    "sandbeach":{"top": hexc("f2dcae"), "side": hexc("d8a878"), "rock": hexc("a87048")},
    "khondalite":{"top": hexc("d8a070"), "side": hexc("b87848"), "rock": hexc("8a5434")},
    "ice":      {"top": hexc("e6eefa"), "side": hexc("bcd8f0"), "rock": hexc("7fa6d0")},
    "taxi":     {"top": hexc("f2c230"), "side": hexc("1c1c20"), "rock": hexc("101014")},
    "rooftop":  {"top": hexc("8a8f9a"), "side": hexc("4a4f60"), "rock": hexc("2a2e3c")},
    "candy":    {"top": hexc("ffe1ee"), "side": hexc("ff9ac0"), "rock": hexc("c86a9a")},
    "cloud":    {"top": hexc("fff6ea"), "side": hexc("f2e3d0"), "rock": hexc("e6d2bd")},
}

DECOR_PRESETS: dict[str, list[tuple[str, float, float, float]]] = {
    # mesh, weight, min scale, max scale
    "meadow":  [("tree", 3, 0.9, 1.4), ("bush", 3, 0.7, 1.2), ("flower", 6, 0.8, 1.3), ("rock", 2, 0.5, 1.0), ("lamp", 0.5, 1, 1)],
    "jungle":  [("palm", 3, 0.9, 1.3), ("bush", 4, 0.8, 1.4), ("flower", 3, 0.8, 1.2), ("rock", 2, 0.6, 1.2)],
    "desert":  [("cactus", 3, 0.8, 1.4), ("rock", 4, 0.6, 1.5), ("bush", 1, 0.5, 0.8)],
    "crystal": [("crystal", 4, 0.6, 1.6), ("shroom", 4, 0.7, 1.3), ("rock", 1, 0.5, 1.0)],
    "citadel": [("column", 2, 0.9, 1.2), ("brazier", 2, 1, 1), ("rock", 1, 0.5, 0.9)],
    "sahyadri": [("tree", 3, 0.9, 1.5), ("bush", 3, 0.8, 1.3), ("marigold", 2, 0.9, 1.2), ("rock", 3, 0.6, 1.3), ("flower", 2, 0.8, 1.2)],
    "konkan":  [("palm", 4, 0.9, 1.4), ("bush", 2, 0.8, 1.2), ("marigold", 1, 0.9, 1.1), ("rock", 2, 0.6, 1.1)],
    "festival": [("kandil", 1.5, 0.9, 1.1), ("diya", 3, 0.9, 1.3), ("marigold", 3, 0.9, 1.3), ("tree", 1, 0.9, 1.2), ("bush", 1, 0.8, 1.1)],
    "himalaya": [("deodar", 3, 0.9, 1.4), ("buransh", 2, 0.9, 1.3), ("kamal", 3, 0.9, 1.3), ("rock", 2, 0.6, 1.2), ("flower", 2, 0.8, 1.2)],
    "kalinga": [("palm", 4, 0.9, 1.4), ("bush", 2, 0.8, 1.2), ("marigold", 2, 0.9, 1.2), ("rock", 1, 0.6, 1.0)],
    "frost":   [("pine", 4, 0.9, 1.5), ("crystal", 2, 0.6, 1.2), ("rock", 2, 0.6, 1.2), ("snowman", 0.6, 1.0, 1.15)],
    "city":    [("tank", 2, 0.9, 1.2), ("dish", 2, 0.9, 1.2), ("lamp", 2, 1.0, 1.0)],
    "candy":   [("tree", 2, 0.9, 1.3), ("flower", 5, 0.9, 1.4), ("bush", 2, 0.8, 1.2)],
    "none": [],
}
COLLIDE_DECOR = {"tree": 0.35, "palm": 0.3, "cactus": 0.4, "column": 0.55, "brazier": 0.45, "pine": 0.3, "tank": 0.6, "snowman": 0.4, "deodar": 0.35, "buransh": 0.35}


class LintError(Exception):
    pass


# ---------------------------------------------------------------------------
# movement envelope
# ---------------------------------------------------------------------------
def max_reach(dy: float, double: bool = True) -> float:
    """Max horizontal distance coverable while ending dy higher (negative = drop)."""
    g_up, g_dn = GRAVITY, GRAVITY * FALL_MULT
    best = 0.0
    # simulate coarse arc: jump, optionally double jump at apex-ish
    for dj_at in ([None] if not double else [None, 0.2, 0.3, 0.4, 0.5]):
        y, vy, t, used = 0.0, JUMP_V, 0.0, False
        dt = 1 / 240
        while t < 4:
            if dj_at is not None and not used and t >= dj_at:
                vy, used = DJUMP_V, True
            vy -= (g_up if vy > 0 else g_dn) * dt
            y += vy * dt
            t += dt
            if vy < 0 and y <= dy:
                break
        if vy < 0 and y <= dy + 0.05:
            best = max(best, t * MAX_SPEED)
    return best


# ---------------------------------------------------------------------------
# compiler
# ---------------------------------------------------------------------------
class Compiler:
    def __init__(self, src: dict, name: str):
        self.src = src
        self.name = name
        L = src["level"]
        self.rng = random.Random(L.get("seed", 1))
        self.solids: list[dict] = []
        self.islands: list[dict] = []
        self.sparks: list[list[float]] = []
        self.decor: list[dict] = []
        self.grass: list[dict] = []
        self.warnings: list[str] = []
        self.keepouts: list[tuple[float, float, float]] = []  # x, z, radius
        self.crates: list[str] = []

    # -- helpers ---------------------------------------------------------
    def style(self, name: str) -> dict:
        if name not in STYLES:
            raise LintError(f"unknown style '{name}'")
        return STYLES[name]

    def add_solid(self, shape: str, pos, size, style: str, move=None, kind="solid", power=0.0, visual=None, color=None):
        st = self.style(style)
        solid = {
            "shape": shape,
            "pos": [round(v, 3) for v in pos],
            "size": [round(v, 3) for v in size],
            "style": style,
            "colors": [st["top"], st["side"], st["rock"]],
            "kind": kind,
        }
        if color:
            solid["colors"][0] = hexc(color)
        if power:
            solid["power"] = power
        if move:
            solid["move"] = self.norm_move(move)
        if visual:
            solid["visual"] = visual
        self.solids.append(solid)
        return solid

    @staticmethod
    def norm_move(m: dict) -> dict:
        t = m.get("type", "line")
        out = {"type": t, "speed": m.get("speed", 1.0), "phase": m.get("phase", 0.0)}
        if t == "line":
            ax = m.get("axis", [1, 0, 0])
            l = math.sqrt(sum(a * a for a in ax)) or 1
            out["axis"] = [a / l for a in ax]
            out["amp"] = m.get("amp", 3.0)
        elif t == "circle":
            out["radius"] = m.get("radius", 4.0)
        elif t == "bob":
            out["type"] = "line"
            out["axis"] = [0, 1, 0]
            out["amp"] = m.get("amp", 1.5)
        return out

    # -- element compilers ---------------------------------------------------
    def island(self, e: dict):
        x, y, z = e["pos"]
        r = e["radius"]
        shape = e.get("shape", "island")
        floor_y = self.src["theme"].get("floorY", -40)
        depth = e.get("depth", (y - floor_y + 1.5) if shape == "pillar" else max(3.0, r * 0.9))
        thick = 1.2
        s = self.add_solid("cyl", [x, y - thick / 2, z], [r, thick / 2], e.get("style", "meadow"),
                           move=e.get("move"),
                           visual={"type": "island", "depth": depth, "shape": 1 if shape == "pillar" else 0,
                                   "seed": self.rng.randint(1, 1 << 30)})
        if shape == "pillar":
            # pillar body is solid all the way down
            body_h = depth - thick
            if body_h > 0.5:
                self.add_solid("cyl", [x, y - thick - body_h / 2, z], [r * 0.95, body_h / 2], e.get("style", "meadow"),
                               visual={"type": "none"}, move=e.get("move"))
                if e.get("move"):
                    self.solids[-1]["move"] = s["move"]
        self.islands.append({"pos": [x, y, z], "radius": r, "decor": e.get("decor", "none"),
                             "density": e.get("density", 1.0), "moving": bool(e.get("move")),
                             "solid": len(self.solids) - (2 if shape == "pillar" and depth - thick > 0.5 else 1),
                             "grass": e.get("grass", e.get("decor") in ("meadow", "jungle", "sahyadri", "festival", "himalaya"))})

    def block(self, e: dict):
        x, y, z = e["pos"]
        sx, sy, sz = e.get("size", [3, 1, 3])
        # pos = top centre for authoring convenience
        self.add_solid("box", [x, y - sy / 2, z], [sx / 2, sy / 2, sz / 2], e.get("style", "stone"),
                       move=e.get("move"), kind=e.get("kind", "solid"), power=e.get("power", 0.0),
                       visual={"type": e.get("visual", "block")})

    def disc(self, e: dict):
        x, y, z = e["pos"]
        r = e.get("radius", 1.5)
        h = e.get("height", 0.8)
        self.add_solid("cyl", [x, y - h / 2, z], [r, h / 2], e.get("style", "stone"),
                       move=e.get("move"), kind=e.get("kind", "solid"), power=e.get("power", 0.0),
                       visual={"type": e.get("visual", "disc")})

    def crate(self, e: dict):
        """Smashable crate (ground pound). pos = point on the surface it sits on."""
        x, y, z = e["pos"]
        contains = e.get("contains", "sparks")
        if contains not in ("sparks", "heart"):
            raise LintError(f"crate contains '{contains}'? use sparks or heart")
        self.add_solid("box", [x, y + 0.6, z], [0.6, 0.6, 0.6], "wood", visual={"type": "crate", "contains": contains})
        self.keepouts.append((x, z, 1.8))
        self.crates.append(contains)

    def bouncer(self, e: dict):
        x, y, z = e["pos"]
        self.add_solid("cyl", [x, y + 0.2, z], [1.1, 0.2], e.get("style", "terracotta"), kind="bounce",
                       power=e.get("power", 24.0), visual={"type": "bouncer"}, move=e.get("move"))
        self.keepouts.append((x, z, 1.8))

    def path(self, e: dict):
        a, b = e["from"], e["to"]
        n = e.get("count", 3)
        arc = e.get("arc", 0.0)
        mv = e.get("move")
        alt = e.get("alternate", False)
        for i in range(n):
            t = i / (n - 1) if n > 1 else 0.5
            p = [a[k] + (b[k] - a[k]) * t for k in range(3)]
            p[1] += math.sin(t * math.pi) * arc
            this_move = None
            if mv:
                this_move = dict(mv)
                this_move["phase"] = mv.get("phase", 0.0) + (math.pi if alt and i % 2 else 0) + i * mv.get("stagger", 0.0)
            elem = {"pos": p, "style": e.get("style", "stone"), "move": this_move}
            if e.get("shape", "disc") == "block":
                elem["size"] = e.get("size", [2.6, 0.8, 2.6])
                self.block(elem)
            else:
                elem["radius"] = e.get("radius", 1.4)
                elem["height"] = e.get("height", 0.8)
                self.disc(elem)
            if e.get("sparks", True):
                self.sparks.append([p[0], p[1] + 1.3, p[2]])

    def spiral(self, e: dict):
        cx, cz = e["center"]
        r = e["radius"]
        y0, y1 = e["from_y"], e["to_y"]
        n = e["count"]
        a0 = math.radians(e.get("start_deg", 0))
        turn = math.radians(e.get("deg_per_step", 40))
        for i in range(n):
            t = i / max(1, n - 1)
            ang = a0 + turn * i
            p = [cx + math.cos(ang) * r, y0 + (y1 - y0) * t, cz + math.sin(ang) * r]
            self.block({"pos": p, "size": e.get("size", [2.4, 0.6, 2.4]), "style": e.get("style", "stone"),
                        "move": e.get("move") if (e.get("move") and i % 3 == 1) else None})
            if e.get("sparks", True) and i % 2 == 0:
                self.sparks.append([p[0], p[1] + 1.3, p[2]])

    def spark_pattern(self, e: dict):
        t = e.get("type", "line")
        n = e.get("count", 5)
        if t == "point":
            self.sparks.append(list(e["pos"]))
        elif t == "line":
            a, b = e["from"], e["to"]
            for i in range(n):
                u = i / max(1, n - 1)
                self.sparks.append([a[k] + (b[k] - a[k]) * u for k in range(3)])
        elif t == "arc":
            a, b = e["from"], e["to"]
            h = e.get("height", 3)
            for i in range(n):
                u = i / max(1, n - 1)
                p = [a[k] + (b[k] - a[k]) * u for k in range(3)]
                p[1] += math.sin(u * math.pi) * h
                self.sparks.append(p)
        elif t == "ring":
            c = e["center"]
            r = e.get("radius", 3)
            for i in range(n):
                ang = i / n * math.tau
                self.sparks.append([c[0] + math.cos(ang) * r, c[1], c[2] + math.sin(ang) * r])
        elif t == "column":
            c = e["pos"]
            for i in range(n):
                self.sparks.append([c[0], c[1] + i * e.get("step", 1.2), c[2]])

    # -- decor scattering (Poisson-disk on island tops) -------------------------
    def scatter(self):
        for isl in self.islands:
            preset = DECOR_PRESETS.get(isl["decor"], [])
            x, y, z = isl["pos"]
            r = isl["radius"]
            if isl["grass"]:
                self.grass.append({"pos": [x, y, z], "radius": round(r * 0.92, 2), "solid": isl["solid"]})
            if not preset:
                continue
            weights = [p[1] for p in preset]
            target = int(isl["density"] * r * r * 0.18)
            placed: list[tuple[float, float, float]] = []
            tries = 0
            while len(placed) < target and tries < target * 30:
                tries += 1
                ang = self.rng.random() * math.tau
                rad = math.sqrt(self.rng.random()) * r * 0.86
                px, pz = x + math.cos(ang) * rad, z + math.sin(ang) * rad
                mesh, _, s0, s1 = self.rng.choices(preset, weights)[0]
                spacing = {"tree": 2.6, "palm": 2.4, "column": 3.0, "brazier": 2.5, "cactus": 2.0, "crystal": 1.6, "kandil": 2.4, "pine": 2.4, "tank": 2.8, "dish": 1.8, "snowman": 2.0, "deodar": 2.6, "buransh": 2.6}.get(mesh, 1.0)
                # big collidable things stay on the outer ring so the centre path is clear
                if mesh in COLLIDE_DECOR and rad < r * 0.5:
                    continue
                if any((px - qx) ** 2 + (pz - qz) ** 2 < (spacing + qs) ** 2 * 0.5 for qx, qz, qs in placed):
                    continue
                if any((px - kx) ** 2 + (pz - kz) ** 2 < kr * kr for kx, kz, kr in self.keepouts):
                    continue
                s = round(self.rng.uniform(s0, s1), 2)
                d = {"mesh": mesh, "pos": [round(px, 2), y, round(pz, 2)], "rot": round(self.rng.random() * math.tau, 2),
                     "scale": s, "seed": self.rng.randint(0, 9999)}
                if isl["moving"]:
                    d["solid"] = isl["solid"]
                self.decor.append(d)
                placed.append((px, pz, spacing))
                if mesh in COLLIDE_DECOR and not isl["moving"]:
                    cr = COLLIDE_DECOR[mesh] * s
                    self.add_solid("cyl", [px, y + 1.5 * s, pz], [cr, 1.5 * s], "stone", visual={"type": "none"})

    # -- reachability lint --------------------------------------------------------
    def nav_nodes(self) -> list[dict]:
        nodes = []
        for i, s in enumerate(self.solids):
            if s.get("visual", {}).get("type") == "none":
                continue
            top = s["pos"][1] + s["size"][1]
            if s["shape"] == "cyl":
                hr = s["size"][0]
            else:
                hr = min(s["size"][0], s["size"][2])
            amp = 0.0
            if "move" in s:
                amp = s["move"].get("amp", s["move"].get("radius", 0))
            nodes.append({"i": i, "x": s["pos"][0], "z": s["pos"][2], "top": top, "r": hr, "amp": amp,
                          "bounce": s["kind"] == "bounce", "power": s.get("power", 0)})
        return nodes

    def lint(self, spawn, goal):
        nodes = self.nav_nodes()

        def under(p):
            best = None
            for n in nodes:
                if (p[0] - n["x"]) ** 2 + (p[2] - n["z"]) ** 2 <= (n["r"] + n["amp"] + 0.5) ** 2 and n["top"] <= p[1] + 0.6:
                    if best is None or n["top"] > best["top"]:
                        best = n
            return best

        start, end = under(spawn), under(goal)
        if not start:
            raise LintError("spawn is not above any surface")
        if not end:
            raise LintError("goal is not above any surface")
        reach_cache: dict[float, float] = {}

        def reach(dy):
            k = round(dy, 1)
            if k not in reach_cache:
                reach_cache[k] = max_reach(k)
            return reach_cache[k]

        seen = {start["i"]}
        q = deque([start])
        while q:
            a = q.popleft()
            for b in nodes:
                if b["i"] in seen:
                    continue
                dy = b["top"] - a["top"]
                gap = math.hypot(a["x"] - b["x"], a["z"] - b["z"]) - a["r"] - b["r"] - a["amp"] - b["amp"]
                if a["bounce"]:
                    # spring: apex height from launch power
                    apex = a["power"] ** 2 / (2 * GRAVITY) + DJUMP_V ** 2 / (2 * GRAVITY)
                    ok = dy <= apex and gap <= 14
                else:
                    ok = dy <= 4.3 and gap <= reach(dy) * 0.92 + P_RADIUS + DASH_BONUS
                if ok or gap <= 0:
                    seen.add(b["i"])
                    q.append(b)
        if end["i"] not in seen:
            raise LintError("goal is NOT reachable from spawn with current jump physics")
        unreachable = [n for n in nodes if n["i"] not in seen]
        if unreachable:
            self.warnings.append(f"{len(unreachable)} platform(s) unreachable (decorative?)")
        # sparks floating too high above any reachable surface
        reachable = [n for n in nodes if n["i"] in seen]
        lost = 0
        for sp in self.sparks:
            if not any((sp[0] - n["x"]) ** 2 + (sp[2] - n["z"]) ** 2 <= (n["r"] + n["amp"] + 9) ** 2 and
                       -2 <= sp[1] - n["top"] <= 9 for n in reachable):
                lost += 1
        if lost:
            self.warnings.append(f"{lost} spark(s) may be out of reach")
        return len(seen), len(nodes)

    # -- main ----------------------------------------------------------------------
    def compile(self) -> dict:
        S = self.src
        L = S["level"]
        spawn = L["spawn"]
        goal = L["goal"]
        self.keepouts += [(spawn[0], spawn[2], 2.5), (goal[0], goal[2], 3.5)]
        for c in S.get("checkpoint", []):
            self.keepouts.append((c["pos"][0], c["pos"][2], 2.0))
        for e in S.get("bouncer", []):
            self.keepouts.append((e["pos"][0], e["pos"][2], 2.0))
        for e in S.get("enemy", []):
            if "a" in e:
                self.keepouts.append((e["a"][0], e["a"][2], 1.5))
                self.keepouts.append((e["b"][0], e["b"][2], 1.5))

        for e in S.get("island", []):
            self.island(e)
        for e in S.get("block", []):
            self.block(e)
        for e in S.get("disc", []):
            self.disc(e)
        for e in S.get("bouncer", []):
            self.bouncer(e)
        for e in S.get("path", []):
            self.path(e)
        for e in S.get("crate", []):
            self.crate(e)
        for e in S.get("spiral", []):
            self.spiral(e)
        for e in S.get("sparks", []):
            self.spark_pattern(e)
        for s in self.solids:
            if s.get("visual", {}).get("type") in ("block", "disc", "bouncer"):
                rr = s["size"][0] + (s["move"].get("amp", s["move"].get("radius", 0)) if "move" in s else 0)
                self.keepouts.append((s["pos"][0], s["pos"][2], rr + 3.0))
        self.scatter()
        for d in S.get("decor", []):
            self.decor.append({"mesh": d["mesh"], "pos": d["pos"], "rot": d.get("rot", 0.0), "scale": d.get("scale", 1.0),
                               "seed": d.get("seed", 1), **({"size": d["size"]} if "size" in d else {})})

        reach_n, total_n = self.lint(spawn, goal)

        quests = L.get("quests", ["all_sparks", "tokens", "no_hurt"])
        bad = [q for q in quests if q not in QUEST_IDS]
        if bad or len(quests) != 3:
            raise LintError(f"quests must be 3 of {sorted(QUEST_IDS)} (got {quests})")
        if "crates" in quests and not self.crates:
            raise LintError("quest 'crates' needs at least one [[crate]]")
        if "stomp_all" in quests and not S.get("enemy"):
            raise LintError("quest 'stomp_all' needs at least one [[enemy]]")

        theme = dict(S["theme"])
        for k, v in list(theme.items()):
            if isinstance(v, str) and v.startswith("#"):
                theme[k] = hexc(v)

        out = {
            "id": L["id"],
            "campaign": L.get("campaign", "clawd"),
            "name": L["name"],
            "subtitle": L.get("subtitle", ""),
            "story": L.get("story", ""),
            "music": L.get("music", "meadows"),
            "gravity": L.get("gravity", 1.0),
            "spawn": spawn,
            "goal": goal,
            "killY": L.get("killY", theme.get("floorY", -30) - 4),
            "parTime": L.get("parTime", 120),
            "quests": quests,
            "crateCount": len(self.crates),
            "sparkTotal": len(self.sparks) + 3 * self.crates.count("sparks"),
            "theme": theme,
            "solids": self.solids,
            "sparks": [[round(v, 2) for v in s] for s in self.sparks],
            "tokens": [t["pos"] for t in S.get("token", [])],
            "checkpoints": [c["pos"] for c in S.get("checkpoint", [])],
            "enemies": S.get("enemy", []),
            "lasers": S.get("laser", []),
            "hints": S.get("hint", []),
            "decor": self.decor,
            "grass": self.grass,
        }
        stats = (f"{len(self.solids):3d} solids  {out['sparkTotal']:3d} sparks  {len(self.crates)} crates  {len(out['tokens'])} tokens  "
                 f"{len(self.decor):3d} decor  {len(out['enemies'])} enemies  nav {reach_n}/{total_n}")
        return out, stats


def main() -> int:
    src_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "levels")
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "dist/levels")
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    failed = False
    for f in sorted(src_dir.glob("*.toml")):
        try:
            data = tomllib.loads(f.read_text(encoding="utf-8"))
            comp = Compiler(data, f.stem)
            lvl, stats = comp.compile()
        except (LintError, KeyError, tomllib.TOMLDecodeError) as ex:
            print(f"  [level] FAIL {f.name}: {ex}")
            failed = True
            continue
        (out_dir / f"{f.stem}.json").write_text(json.dumps(lvl, separators=(",", ":")), encoding="utf-8")
        manifest.append({"id": lvl["id"], "campaign": lvl["campaign"], "file": f"{f.stem}.json", "name": lvl["name"], "subtitle": lvl["subtitle"],
                         "theme": {k: lvl["theme"][k] for k in ("skyTop", "skyHorizon", "accent") if k in lvl["theme"]},
                         "sparks": lvl["sparkTotal"], "parTime": lvl["parTime"], "quests": lvl["quests"]})
        print(f"  [level] {f.stem:22s} {stats}")
        for w in comp.warnings:
            print(f"          warn: {w}")
    manifest.sort(key=lambda m: m["id"])
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
