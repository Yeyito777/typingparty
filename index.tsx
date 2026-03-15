/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

// ── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    enableConfetti: {
        type: OptionType.BOOLEAN,
        description: "Spawn confetti particles while typing",
        default: true,
    },
    enableScreenShake: {
        type: OptionType.BOOLEAN,
        description: "Shake the chat area based on rank",
        default: true,
    },
    shakeIntensity: {
        type: OptionType.SLIDER,
        description: "Screen shake cap — lower = less shaking (1 = subtle, 4 = full)",
        markers: [1, 2, 3, 4, 5, 6, 7, 8],
        default: 2,
        stickToMarkers: true,
    },
    confettiDensity: {
        type: OptionType.SLIDER,
        description: "Confetti particles per keystroke",
        markers: [1, 2, 3, 4, 5],
        default: 2,
        stickToMarkers: true,
    },
    comboTimeoutMs: {
        type: OptionType.SLIDER,
        description: "Seconds of inactivity before combo resets",
        markers: [1, 2, 3, 4, 5, 6, 7, 8],
        default: 3,
        stickToMarkers: true,
    },
    honoredOneAudioUrl: {
        type: OptionType.STRING,
        description: "YouTube embed URL for the secret Honored One rank theme",
        default: "https://www.youtube.com/embed/zv2nHpEgqVU",
    },
});

// ── Rank config ───────────────────────────────────────────────────────────────

const RANKS = [
    { id: "d",     min: 0,  label: "D",     color: "#4e5058" },
    { id: "c",     min: 12, label: "C",     color: "#72767d" },
    { id: "b",     min: 28, label: "B",     color: "#4d96ff" },
    { id: "a",     min: 46, label: "A",     color: "#40c057" },
    { id: "s",     min: 64, label: "S",     color: "#ffd93d" },
    { id: "wild",  min: 78, label: "WILD",  color: "#ff922b" },
    { id: "devil", min: 90, label: "DEVIL", color: "#ff6b6b" },
] as const;

const ACTIVE_DRAIN = [0.8, 1.0, 1.5, 2.5, 4.0, 6.5, 10.0] as const;
const IDLE_DRAIN   = [4.0, 4.0, 5.0, 6.0, 8.0, 12.0, 16.0] as const;

function getRankIndex(score: number): number {
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (score >= RANKS[i].min) return i;
    }
    return 0;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = [
    "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
    "#ff6fff", "#845ef7", "#ff922b", "#20c997",
];

// ── State ─────────────────────────────────────────────────────────────────────

let hud: HTMLDivElement | null = null;
let particleContainer: HTMLDivElement | null = null;

let combo              = 0;
let comboMultiplier    = 1;
let comboTimer: ReturnType<typeof setTimeout> | null = null;
let messagesSentInWindow = 0;
let lastMessageTime    = 0;
let usedBackspace      = false;

let styleScore  = 0;
let prevRankIdx = 0;
let drainInterval: ReturnType<typeof setInterval> | null = null;

let keystrokeIntervals: number[] = [];
let lastRhythmTime    = 0;
let flowStateCooldown = 0;

let wpmTimestamps: number[] = [];
let wpm = 0;

let peakRankIdx     = 0;
let peakWpm         = 0;
let highCombo       = 0;
let summaryTimeout: ReturnType<typeof setTimeout> | null = null;
let summaryTriggered = false;

let lastShakeTime = 0;

let honoredOneActive    = false;
let honoredOneIframe: HTMLIFrameElement | null = null;

// ── Utility ───────────────────────────────────────────────────────────────────

function getBarRect(): DOMRect | null {
    return (document.querySelector("[class*='channelTextArea']") as HTMLElement | null)?.getBoundingClientRect() ?? null;
}

// ── Rolling WPM ───────────────────────────────────────────────────────────────

function recordKeystrokeForWpm() {
    const now = Date.now();
    wpmTimestamps.push(now);
    wpmTimestamps = wpmTimestamps.filter(t => t >= now - 5000);
    const n = wpmTimestamps.length;
    if (n < 2) { wpm = 0; return; }
    const elapsed = (now - wpmTimestamps[0]) / 60000;
    wpm = elapsed < 0.005 ? 0 : Math.round((n / 5) / elapsed);
}

// ── Rhythm ────────────────────────────────────────────────────────────────────

function getRhythmConsistency(): number {
    if (keystrokeIntervals.length < 3) return 0;
    const mean = keystrokeIntervals.reduce((a, b) => a + b, 0) / keystrokeIntervals.length;
    if (!mean) return 0;
    const variance = keystrokeIntervals.reduce((s, v) => s + (v - mean) ** 2, 0) / keystrokeIntervals.length;
    return Math.max(0, 1 - Math.sqrt(variance) / mean);
}

function recordInterval() {
    const now = Date.now();
    if (lastRhythmTime > 0) {
        const iv = now - lastRhythmTime;
        if (iv >= 50 && iv <= 3000) {
            keystrokeIntervals.push(iv);
            if (keystrokeIntervals.length > 8) keystrokeIntervals.shift();
        } else if (iv > 3000) {
            keystrokeIntervals = [];
        }
    }
    lastRhythmTime = now;
}

// ── Style meter ───────────────────────────────────────────────────────────────

function gainStyle() {
    const speedBonus  = Math.min(wpm / 40, 4);
    const rhythmBonus = getRhythmConsistency() * 4;
    styleScore = Math.min(100, styleScore + 1.5 + speedBonus + rhythmBonus);

    const now = Date.now();
    if (keystrokeIntervals.length >= 6 && getRhythmConsistency() >= 0.75 && now - flowStateCooldown > 10000) {
        flowStateCooldown = now;
        styleScore = Math.min(100, styleScore + 15);
        showPopup("flow state", "#4d96ff");
    }
}

function hurtStyle(amount: number) {
    styleScore = Math.max(0, styleScore - amount);
}

function startDrainLoop() {
    if (drainInterval) return;
    drainInterval = setInterval(() => {
        // Recalculate wpm every tick so it decays naturally when typing stops
        const now = Date.now();
        wpmTimestamps = wpmTimestamps.filter(t => t >= now - 5000);
        const wpmN = wpmTimestamps.length;
        if (wpmN >= 2) {
            const elapsed = (now - wpmTimestamps[0]) / 60000;
            wpm = elapsed < 0.005 ? 0 : Math.round((wpmN / 5) / elapsed);
        } else {
            wpm = 0;
        }
        if (honoredOneActive && wpm < 300) deactivateHonoredOne();

        if (styleScore <= 0) {
            if (!summaryTriggered && !summaryTimeout && (peakRankIdx > 1 || highCombo > 5)) {
                summaryTimeout = setTimeout(() => { summaryTimeout = null; showSummary(); }, 3000);
            }
            return;
        }
        const ri   = getRankIndex(styleScore);
        const idle = now - lastRhythmTime > 2000;
        styleScore = Math.max(0, styleScore - (idle ? IDLE_DRAIN[ri] : ACTIVE_DRAIN[ri]));
        updateHud();
    }, 100);
}

// ── Popup (minimal — only used for Flow State) ────────────────────────────────

function showPopup(text: string, color: string) {
    const rect = getBarRect();
    if (!rect) return;
    const el = document.createElement("div");
    el.className = "tp-popup";
    el.style.cssText = `
        right:${window.innerWidth - rect.right + 8}px;
        bottom:${window.innerHeight - rect.top + 52}px;
        color:${color};
        text-shadow:0 0 12px ${color}80;
    `;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// ── Bar glow ──────────────────────────────────────────────────────────────────

function updateBarGlow(rankIdx: number) {
    const bar = document.querySelector("[class*='channelTextArea']") as HTMLElement | null;
    if (!bar) return;
    bar.style.transition = "box-shadow 0.5s ease";
    if (honoredOneActive)
        bar.style.boxShadow = "0 0 0 1.5px rgba(199,125,255,0.5),0 0 32px rgba(155,89,182,0.22)";
    else if (rankIdx === 6)
        bar.style.boxShadow = "0 0 0 1px rgba(255,107,107,0.35),0 0 20px rgba(255,107,107,0.14)";
    else if (rankIdx === 5)
        bar.style.boxShadow = "0 0 0 1px rgba(255,146,43,0.25),0 0 14px rgba(255,146,43,0.1)";
    else
        bar.style.boxShadow = "";
}

// ── Session summary ───────────────────────────────────────────────────────────

function showSummary() {
    if (summaryTriggered) return;
    summaryTriggered = true;
    const rect = getBarRect();
    if (!rect) return;
    const peak = RANKS[peakRankIdx];
    const el = document.createElement("div");
    el.id = "tp-summary";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 8}px;`;
    el.innerHTML = `
        <div class="tp-sum-label">session</div>
        <div class="tp-sum-rank" style="color:${peak.color}">${peak.label}</div>
        <div class="tp-sum-stats">
            <span><b>${highCombo}</b><small>combo</small></span>
            ${peakWpm > 0 ? `<span><b>${peakWpm}</b><small>wpm</small></span>` : ""}
        </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = "tp-fade-out 0.5s ease-out forwards";
        setTimeout(() => {
            el.remove();
            peakRankIdx = 0; peakWpm = 0; highCombo = 0;
            summaryTriggered = false; prevRankIdx = 0;
        }, 500);
    }, 5000);
}

function dismissSummary() {
    if (summaryTimeout) { clearTimeout(summaryTimeout); summaryTimeout = null; }
    const el = document.getElementById("tp-summary");
    if (!el) return;
    el.style.animation = "tp-fade-out 0.3s ease-out forwards";
    setTimeout(() => el.remove(), 300);
    peakRankIdx = 0; peakWpm = 0; highCombo = 0;
    summaryTriggered = false; prevRankIdx = 0;
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function createHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "tp-hud";
    hud.innerHTML = `
        <div id="tp-rank-letter">D</div>
        <div id="tp-hud-right">
            <div id="tp-meter-track"><div id="tp-meter-fill"></div></div>
            <div id="tp-hud-stats">
                <span id="tp-combo-count">0</span><span class="tp-x">×</span>
                <span class="tp-sep tp-wpm-sep">·</span>
                <span id="tp-wpm-val"></span>
                <span class="tp-sep tp-pk-sep">·</span>
                <span id="tp-peak-val"></span>
            </div>
        </div>
    `;
    document.body.appendChild(hud);
    particleContainer = document.createElement("div");
    particleContainer.id = "tp-particles";
    document.body.appendChild(particleContainer);
}

function positionHud() {
    if (!hud) return;
    const rect = getBarRect();
    if (!rect) return;
    hud.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    hud.style.right  = `${window.innerWidth - rect.right + 8}px`;
}

function updateHud() {
    if (!hud) return;
    positionHud();

    const rankIdx = getRankIndex(styleScore);
    const rank    = RANKS[rankIdx];

    if (rankIdx > peakRankIdx) peakRankIdx = rankIdx;
    if (wpm > peakWpm) peakWpm = wpm;
    if (combo > highCombo) highCombo = combo;

    if (rankIdx !== prevRankIdx) { prevRankIdx = rankIdx; }
    updateBarGlow(rankIdx);

    hud.dataset.rank = rank.id;
    hud.classList.toggle("tp-visible", styleScore > 0 || honoredOneActive);

    const rankEl  = document.getElementById("tp-rank-letter");
    const fillEl  = document.getElementById("tp-meter-fill");
    const comboEl = document.getElementById("tp-combo-count");
    const wpmEl   = document.getElementById("tp-wpm-val");
    const wpmSep  = hud.querySelector(".tp-wpm-sep") as HTMLElement | null;
    const pkEl    = document.getElementById("tp-peak-val");
    const pkSep   = hud.querySelector(".tp-pk-sep") as HTMLElement | null;

    if (rankEl) { rankEl.textContent = rank.label; rankEl.style.color = rank.color; }

    // ── Honored One override (300 WPM secret rank) ────────────────────────────
    const isHonoredOne = wpm >= 300;
    if (isHonoredOne && !honoredOneActive) activateHonoredOne();
    else if (!isHonoredOne && honoredOneActive) deactivateHonoredOne();
    if (isHonoredOne) {
        hud.dataset.rank = "honored";
        if (rankEl) { rankEl.textContent = "✦"; rankEl.style.color = "#e8d5ff"; }
    }

    // Meter = progress within current rank before dropping
    if (fillEl) {
        const lo  = rank.min;
        const hi  = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1].min : 100;
        const pct = hi > lo ? Math.max(0, Math.min(100, (styleScore - lo) / (hi - lo) * 100)) : 100;
        fillEl.style.width      = `${pct}%`;
        fillEl.style.background = isHonoredOne ? "#c77dff" : rank.color;
        fillEl.style.boxShadow  = rankIdx >= 4 ? `0 0 6px ${rank.color}` : "none";
    }

    if (comboEl) { comboEl.textContent = String(combo); comboEl.style.color = rank.color; }

    if (wpmEl && wpmSep) {
        const show = wpm > 0;
        wpmEl.textContent                      = show ? `${wpm} wpm` : "";
        wpmEl.style.display = wpmSep.style.display = show ? "" : "none";
    }

    if (pkEl && pkSep) {
        const show = peakRankIdx > rankIdx && peakRankIdx > 1;
        pkEl.textContent              = show ? `pk:${RANKS[peakRankIdx].label}` : "";
        pkEl.style.color              = show ? RANKS[peakRankIdx].color : "";
        pkEl.style.display = pkSep.style.display = show ? "" : "none";
    }
}

function destroyHud() {
    hud?.remove(); hud = null;
    particleContainer?.remove(); particleContainer = null;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function spawnConfetti(x: number, y: number) {
    if (!settings.store.enableConfetti || !particleContainer) return;
    const tier = getRankIndex(styleScore);
    if (tier < 1) return;
    const count = Math.min(settings.store.confettiDensity + Math.floor(tier / 2), 6);
    for (let i = 0; i < count; i++) {
        const p     = document.createElement("div");
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const size  = 3 + Math.random() * 5;
        const ang   = Math.random() * Math.PI * 2;
        const vel   = 30 + Math.random() * 60;
        const dx    = Math.cos(ang) * vel, dy = Math.sin(ang) * vel - 25;
        const rot   = Math.random() * 360, dur = 500 + Math.random() * 500;
        const isCircle = Math.random() > 0.5;
        p.style.cssText = `
            position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;
            background:${color};pointer-events:none;z-index:99999;
            border-radius:${isCircle ? "50%" : "2px"};
        `;
        particleContainer.appendChild(p);
        const t0 = performance.now();
        const frame = (now: number) => {
            const prog = (now - t0) / dur;
            if (prog >= 1) { p.remove(); return; }
            p.style.left      = `${x + dx * prog}px`;
            p.style.top       = `${y + dy * prog + 80 * prog * prog}px`;
            p.style.transform = `rotate(${rot + 360 * prog}deg)`;
            p.style.opacity   = String(1 - prog * prog);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }
}

// ── Honored One ───────────────────────────────────────────────────────────────

function activateHonoredOne() {
    if (honoredOneActive) return;
    honoredOneActive = true;

    const banner = document.createElement("div");
    banner.id = "tp-honored-banner";
    banner.innerHTML = `<span class="tp-honored-title">✦ honored one ✦</span><span class="tp-honored-sub">300 wpm</span>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 3000);

    const url = settings.store.honoredOneAudioUrl?.trim();
    if (url) {
        const iframe = document.createElement("iframe");
        iframe.id = "tp-honored-audio";
        iframe.allow = "autoplay; encrypted-media";
        iframe.style.cssText = "display:none;position:fixed;width:1px;height:1px;pointer-events:none;top:-99px;";
        const videoId = url.split("/").pop()?.split("?")[0] ?? "";
        const sep = url.includes("?") ? "&" : "?";
        iframe.src = `${url}${sep}autoplay=1&loop=1&playlist=${videoId}`;
        document.body.appendChild(iframe);
        honoredOneIframe = iframe;
    }
}

function deactivateHonoredOne() {
    if (!honoredOneActive) return;
    honoredOneActive = false;
    honoredOneIframe?.remove();
    honoredOneIframe = null;
    document.getElementById("tp-honored-banner")?.remove();
    const bar = document.querySelector("[class*='channelTextArea']") as HTMLElement | null;
    if (bar) bar.style.boxShadow = "";
}

// ── Screen shake ──────────────────────────────────────────────────────────────

function triggerShake() {
    if (!settings.store.enableScreenShake) return;
    const rankIdx = getRankIndex(styleScore);
    if (rankIdx < 2) return;

    const now = Date.now();
    if (now - lastShakeTime < 110) return;
    lastShakeTime = now;

    const chat = document.querySelector("[class*='chatContent']") as HTMLElement | null;
    if (!chat) return;

    const level = Math.min(rankIdx - 2, 2);
    const scale = settings.store.shakeIntensity / 4;
    const px    = (level + 1) * 3 * scale;
    const dur   = 120 + level * 28;

    chat.animate(
        [
            { transform: "translate(0,0)" },
            { transform: `translate(${-px}px,${px * 0.6}px)` },
            { transform: `translate(${px}px,${-px * 0.6}px)` },
            { transform: `translate(${-px * 0.5}px,${px * 0.35}px)` },
            { transform: "translate(0,0)" },
        ],
        { duration: dur, easing: "ease-out", composite: "replace" }
    );
}

// ── Combo ─────────────────────────────────────────────────────────────────────

function breakCombo() {
    if (combo > 0) hurtStyle(25);
    combo = 0; comboMultiplier = 1;
    updateHud();
}

function incrementCombo() {
    combo++;
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);
}

function onMessageSent() {
    const now = Date.now();
    if (now - lastMessageTime < 5000) {
        messagesSentInWindow++;
        comboMultiplier = Math.min(messagesSentInWindow + 1, 7);
    } else {
        messagesSentInWindow = 1; comboMultiplier = 1;
    }
    lastMessageTime = now;
    if (!usedBackspace && combo > 3) styleScore = Math.min(100, styleScore + 20);
    usedBackspace = false;
    wpmTimestamps = []; wpm = 0; combo = 0;
    updateHud();
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target?.closest?.("[role='textbox']")) return;
    if (e.key.length > 1 && !["Backspace", "Delete"].includes(e.key)) return;

    dismissSummary();

    if (e.key === "Backspace" || e.key === "Delete") {
        usedBackspace = true;
        hurtStyle(40);
        breakCombo();
        return;
    }

    recordInterval();
    recordKeystrokeForWpm();
    incrementCombo();
    gainStyle();

    // Confetti at caret position; collapsed-range rects can be all-zero in some builds
    const sel = window.getSelection();
    let cx: number, cy: number;
    if (sel && sel.rangeCount > 0) {
        const cr = sel.getRangeAt(0).getBoundingClientRect();
        if (cr.left !== 0 || cr.top !== 0) {
            cx = cr.right; cy = cr.top + cr.height * 0.5;
        } else {
            const fb = target.getBoundingClientRect();
            cx = fb.left + fb.width * (0.3 + Math.random() * 0.4); cy = fb.top;
        }
    } else {
        const fb = target.getBoundingClientRect();
        cx = fb.left + fb.width * (0.3 + Math.random() * 0.4); cy = fb.top;
    }
    spawnConfetti(cx, cy);
    triggerShake();
    updateHud();
}

function onKeyDownCapture(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target?.closest?.("[role='textbox']")) setTimeout(onMessageSent, 50);
    }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "TypingParty",
    description: "DMC-inspired style meter — rewards speed and rhythm with confetti, screenshake, and rank-up drama. github.com/sfbabel/typingparty",
    authors: [{ name: "sfbabel", id: 0n }],
    settings,

    start() {
        const fontLink = document.createElement("link");
        fontLink.id = "tp-font"; fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(fontLink);

        const style = document.createElement("style");
        style.id = "tp-styles"; style.textContent = CSS_TEXT;
        document.head.appendChild(style);

        createHud();
        startDrainLoop();
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("keydown", onKeyDownCapture, false);
        window.addEventListener("resize", positionHud);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keydown", onKeyDownCapture, false);
        window.removeEventListener("resize", positionHud);

        if (comboTimer)    clearTimeout(comboTimer);
        if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
        if (summaryTimeout){ clearTimeout(summaryTimeout); summaryTimeout = null; }

        deactivateHonoredOne();
        honoredOneActive = false;

        const chat = document.querySelector("[class*='chatContent']") as HTMLElement | null;
        if (chat) { chat.getAnimations().forEach(a => a.cancel()); chat.style.transform = ""; }
        const bar = document.querySelector("[class*='channelTextArea']") as HTMLElement | null;
        if (bar) bar.style.boxShadow = "";

        document.getElementById("tp-summary")?.remove();
        document.getElementById("tp-honored-banner")?.remove();
        document.querySelectorAll(".tp-popup").forEach(el => el.remove());
        destroyHud();
        document.getElementById("tp-styles")?.remove();
        document.getElementById("tp-font")?.remove();

        combo = 0; comboMultiplier = 1; styleScore = 0; usedBackspace = false;
        keystrokeIntervals = []; wpmTimestamps = []; wpm = 0;
        lastRhythmTime = 0; flowStateCooldown = 0; lastShakeTime = 0;
        messagesSentInWindow = 0; lastMessageTime = 0;
        prevRankIdx = 0; peakRankIdx = 0; peakWpm = 0; highCombo = 0;
        summaryTriggered = false;
    },
});

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
#tp-hud {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'Space Grotesk', 'gg sans', sans-serif;
    pointer-events: none;
    z-index: 9998;
    padding: 8px 14px 8px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    opacity: 0;
    transform-origin: bottom right;
    transition:
        opacity 0.4s ease,
        transform 0.4s cubic-bezier(0.34, 1.3, 0.64, 1),
        background 0.4s ease,
        border-color 0.4s ease,
        box-shadow 0.4s ease;
}
#tp-hud.tp-visible { opacity: 1; }

/* Three tiers: small / medium / full — no jarring 7-step jump */
#tp-hud[data-rank="d"],
#tp-hud[data-rank="c"] { transform: scale(0.82); }

#tp-hud[data-rank="b"],
#tp-hud[data-rank="a"] { transform: scale(1.0); }

#tp-hud[data-rank="s"],
#tp-hud[data-rank="wild"],
#tp-hud[data-rank="devil"] {
    transform: scale(1.15);
    background: rgba(0,0,0,0.55);
    border-color: rgba(255,255,255,0.06);
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    backdrop-filter: blur(14px);
}

#tp-rank-letter {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 30px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.5px;
    min-width: 46px;
    text-align: center;
    text-transform: uppercase;
    transition: color 0.25s ease, text-shadow 0.3s ease;
}
#tp-hud[data-rank="s"]     #tp-rank-letter { text-shadow: 0 0 10px currentColor; }
#tp-hud[data-rank="wild"]  #tp-rank-letter { text-shadow: 0 0 14px currentColor, 0 0 28px currentColor; }
#tp-hud[data-rank="devil"] #tp-rank-letter {
    text-shadow: 0 0 14px currentColor, 0 0 30px currentColor;
    animation: tp-devil-pulse 0.8s ease-in-out infinite alternate;
}
@keyframes tp-devil-pulse {
    from { filter: brightness(1); }
    to   { filter: brightness(1.6); }
}

#tp-hud-right { display: flex; flex-direction: column; gap: 4px; }

#tp-meter-track {
    width: 72px;
    height: 3px;
    border-radius: 2px;
    overflow: hidden;
    background: rgba(255,255,255,0.07);
}
#tp-meter-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.12s ease-out, background 0.25s ease, box-shadow 0.25s ease;
}

#tp-hud-stats {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.5px;
    text-transform: lowercase;
    display: flex;
    align-items: center;
    gap: 3px;
    color: rgba(255,255,255,0.35);
    line-height: 1;
}
#tp-combo-count { font-weight: 600; transition: color 0.2s ease; }
.tp-x   { opacity: 0.3; font-weight: 300; }
.tp-sep { opacity: 0.25; }
#tp-wpm-val  { color: rgba(255,255,255,0.28); }
#tp-peak-val { font-weight: 600; }

/* Flow State popup — the only floating text */
.tp-popup {
    position: fixed;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 2px;
    text-transform: lowercase;
    pointer-events: none;
    z-index: 9999;
    animation: tp-float-up 1.2s ease-out forwards;
}
@keyframes tp-float-up {
    0%   { opacity: 0;   transform: translateY(4px); }
    18%  { opacity: 1;   transform: translateY(-8px); }
    100% { opacity: 0;   transform: translateY(-52px); }
}

/* Session summary */
#tp-summary {
    position: fixed;
    font-family: 'Space Grotesk', sans-serif;
    text-align: center;
    pointer-events: none;
    z-index: 9998;
    background: rgba(18,19,22,0.96);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    padding: 14px 22px 12px;
    backdrop-filter: blur(18px);
    box-shadow: 0 8px 28px rgba(0,0,0,0.55);
    min-width: 130px;
    animation: tp-summary-in 0.4s cubic-bezier(0.34, 1.3, 0.64, 1) forwards;
}
.tp-sum-label  { font-size: 9px; font-weight: 400; letter-spacing: 3px; color: #2e3035; margin-bottom: 4px; text-transform: lowercase; }
.tp-sum-rank   { font-size: 46px; font-weight: 700; line-height: 1; margin-bottom: 8px; }
.tp-sum-stats  { display: flex; justify-content: center; gap: 16px; }
.tp-sum-stats span { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tp-sum-stats b    { font-size: 17px; font-weight: 600; color: #dcddde; line-height: 1; }
.tp-sum-stats small{ font-size: 8px; font-weight: 400; letter-spacing: 2px; color: #2e3035; text-transform: lowercase; }

@keyframes tp-summary-in {
    0%   { opacity: 0; transform: translateY(8px) scale(0.93); }
    100% { opacity: 1; transform: translateY(0)   scale(1); }
}
@keyframes tp-fade-out {
    0%   { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(6px); }
}

/* ── Honored One (secret rank: 300 WPM) ─────────────────────────────────────── */

#tp-honored-banner {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    font-family: 'Space Grotesk', sans-serif;
    pointer-events: none;
    z-index: 99998;
    animation: tp-honored-banner-anim 3s ease-out forwards;
}
.tp-honored-title {
    font-size: 60px;
    font-weight: 700;
    letter-spacing: 10px;
    color: #e8d5ff;
    text-transform: lowercase;
    text-shadow: 0 0 32px #c77dff, 0 0 64px #9b59b6;
}
.tp-honored-sub {
    font-size: 13px;
    font-weight: 300;
    letter-spacing: 8px;
    color: rgba(200,180,255,0.5);
    text-transform: lowercase;
}
@keyframes tp-honored-banner-anim {
    0%   { opacity: 0; transform: translate(-50%, -44%) scale(0.88); }
    12%  { opacity: 1; transform: translate(-50%, -50%) scale(1.02); }
    72%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
    100% { opacity: 0; transform: translate(-50%, -56%) scale(0.96); }
}

#tp-hud[data-rank="honored"] {
    transform: scale(1.5);
    background: rgba(28, 8, 50, 0.9);
    border-color: rgba(200, 150, 255, 0.18);
    box-shadow: 0 0 40px rgba(155,89,182,0.35), 0 4px 24px rgba(0,0,0,0.65);
    backdrop-filter: blur(16px);
}
#tp-hud[data-rank="honored"] #tp-rank-letter {
    animation: tp-honored-pulse 0.9s ease-in-out infinite alternate;
}
@keyframes tp-honored-pulse {
    from { filter: brightness(1.0);   text-shadow: 0 0 16px #e8d5ff, 0 0 32px #9b59b6; }
    to   { filter: brightness(1.9);   text-shadow: 0 0 28px #fff,    0 0 56px #c77dff; }
}

#tp-particles {
    position: fixed; top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none; z-index: 99999; overflow: hidden;
}
`;
