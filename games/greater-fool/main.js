//----------------------------------------------------------
// SUPABASE CONFIG (AUTH + GENEANS)
//----------------------------------------------------------
const supabase = window.supabase.createClient(
  "https://omqyafbpcqolkozzwrcl.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcXlhZmJwY3FvbGtvenp3cmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MTc2OTYsImV4cCI6MjA4MTE5MzY5Nn0.ff-qEqdl11wJxH-EDKYJIhXJYo_eHHN80PHZIFjnzBo"
);

//----------------------------------------------------------
// LEADERBOARD (unchanged REST endpoint)
//----------------------------------------------------------
const SUPABASE_URL = "https://kghuwlfjvhhsaichumpm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnaHV3bGZqdmhoc2FpY2h1bXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNjg0NTEsImV4cCI6MjA4MDk0NDQ1MX0.VjX2VSrfYXxtKe5AquvmTh2q8FoDE-YkuF0IvUaNtyI";

//----------------------------------------------------------
// SEEDABLE RNG
//----------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let rng = Math.random;
let currentSeed = null;
let lastFinalWealth = null;

//----------------------------------------------------------
// AUDIO
//----------------------------------------------------------
const SND_CLICK = new Audio("click.mp3");
const SND_WHALE = new Audio("splash.mp3");
const SND_WHALE_EXIT = new Audio("splashLow.mp3");
const SND_SIREN = new Audio("siren.mp3");

//----------------------------------------------------------
// GENEAN (loaded from Supabase)
//----------------------------------------------------------
let currentGenean = null;

//----------------------------------------------------------
// GAME STATE
//----------------------------------------------------------
let WIS = 0, LUCK = 0, CRT = 0;

let price = 1.0;
let cash = 100.0;
let shares = 0;
let timeLeft = 120;

let maxBuy = 1;
let luckMultiplier = 1;
let maxLeverage = 1;

let inLeverage = false;
let levSide = null;
let levEntry = 0;
let levFactor = 1;
let levCollateral = 0;
let levUnrealised = 0;

let botInterval;
let timerInterval;
let priceHistory = [];
let whaleCount = 0;

//----------------------------------------------------------
// DOM REFERENCES (unchanged)
//----------------------------------------------------------
const priceUI = document.getElementById("price");
const cashUI = document.getElementById("cash");
const sharesUI = document.getElementById("shares");
const wealthUI = document.getElementById("wealth");
const timerUI = document.getElementById("timer");

const buyAmountBtn = document.getElementById("buyAmountBtn");
const sellAmountBtn = document.getElementById("sellAmountBtn");

const logBox = document.getElementById("log");

const canvas = document.getElementById("priceChart");
const ctx = canvas.getContext("2d");

//----------------------------------------------------------
// LOAD GENEAN (AUTO LOGIN)
//----------------------------------------------------------
async function loadGenean() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href =
      "https://gaiaprojectsol.github.io/genean-alpha/";
    return null;
  }

  const { data, error } = await supabase
    .from("geneans")
    .select("*")
    .eq("user_id", session.user.id)
    .single();

  if (error || !data) {
    window.location.href =
      "https://gaiaprojectsol.github.io/genean-alpha/dashboard.html";
    return null;
  }

  currentGenean = data;

  WIS = data.wis;
  LUCK = data.lck;
  CRT = data.crt;

  maxBuy = 1 + Math.floor((WIS / 100) * 9);
  luckMultiplier = 1 + (LUCK / 100);
  maxLeverage = 1 + Math.floor((CRT / 100) * 24);

  buyAmountBtn.textContent = maxBuy;
  sellAmountBtn.textContent = maxBuy;

  document.getElementById("geneanName").textContent = data.name;
  document.getElementById("gWis").textContent = WIS;
  document.getElementById("gLuck").textContent = LUCK;
  document.getElementById("gCrt").textContent = CRT;

  if (CRT > 0) {
    document.getElementById("leverage-panel").style.display = "flex";
  }

  return data;
}

//----------------------------------------------------------
// INTRO → START GAME (NO CHARACTER SELECT)
//----------------------------------------------------------
document.getElementById("start-game-btn").addEventListener("click", () => {
    const seedInput = document.getElementById("seed-input");
    let seed = parseInt(seedInput.value, 10);

    // Generate seed if missing
    if (!Number.isFinite(seed) || seed <= 0) {
        seed = Math.floor(Math.random() * 1_000_000_000);
        seedInput.value = seed;
    }

    currentSeed = seed;
    rng = mulberry32(seed);

    // Hide intro
    document.getElementById("intro-screen").style.display = "none";

    // Show game container
    document.querySelector(".container").style.display = "block";

    // Attach buttons + start game
    attachTradingButtons();
    startGame();
});


//----------------------------------------------------------
// BOT RANDOM MOVES (seeded)
//----------------------------------------------------------
function botAction() {
    const r = rng();
    if (r < 0.33) return rng() * 0.5;
    if (r < 0.66) return -(rng() * 0.5);
    return 0;
}

//----------------------------------------------------------
// WHALE & MEGA WHALE EVENTS (seeded, LUCK-scaled)
//----------------------------------------------------------
function whaleEvents() {
    const whaleBoost = 1 + (LUCK / 100);

    // Whale enter
    if (rng() < 0.01 * whaleBoost) {
        const boost = Math.floor(rng() * 91) + 10;
        price += boost;
        whaleCount++;
        totalWhaleEnters++;
        if (boost > biggestUp) biggestUp = boost;

        SND_WHALE.currentTime = 0;
        SND_WHALE.play();
        addLog(`🐋 Whale ENTERED! +$${boost}`);
    }

    // Whale exit
    if (whaleCount > 0 && rng() < 0.01 * whaleBoost) {
        const drop = Math.floor(rng() * 91) + 10;
        price -= drop;
        if (price < 0.01) price = 0.01;

        whaleCount--;
        totalWhaleExits++;
        if (-drop < biggestDown) biggestDown = -drop;

        SND_WHALE_EXIT.currentTime = 0;
        SND_WHALE_EXIT.play();
        addLog(`🐋 Whale EXITED! -$${drop}`);
    }

    // Mega whale
    if (rng() < 0.001 * whaleBoost) {
        const mega = Math.floor(rng() * 1501) + 500;
        price += mega;
        whaleCount += 3;
        totalMegaWhales++;
        if (mega > biggestUp) biggestUp = mega;

        SND_WHALE.currentTime = 0;
        SND_WHALE.play();
        addLog(`💥 MEGA WHALE ARRIVED! +$${mega}`);
    }
}

//----------------------------------------------------------
// PRICE UPDATE + REAL-TIME LEVERAGE PnL
//----------------------------------------------------------
function updatePrice() {
    let change = botAction() * luckMultiplier;

    whaleEvents();

    price += change;
    if (price < 0.01) price = 0.01;
    price = +price.toFixed(2);

    if (change > biggestUp)   biggestUp = change;
    if (change < biggestDown) biggestDown = change;

    if (price > highestPrice) highestPrice = price;
    if (price < lowestPrice)  lowestPrice = price;

    if (change > 0)      priceUI.style.color = "#00ff88";
    else if (change < 0) priceUI.style.color = "#ff4444";
    setTimeout(() => priceUI.style.color = "white", 200);

    priceUI.textContent = `$${price}`;

    priceHistory.push(price);
    if (priceHistory.length > 200) priceHistory.shift();

    if (inLeverage) {
        let returnPct = (price - levEntry) / levEntry;
        if (levSide === "short") {
            returnPct = (levEntry - price) / levEntry;
        }
        levUnrealised = returnPct * levFactor * levCollateral;
    }

    updateWealth();
    drawChart();
    checkLiquidation();
}

//----------------------------------------------------------
// BUY / SELL
//----------------------------------------------------------
function buyShare() {
    if (inLeverage) return addLog("Cannot buy while leveraged.");
    if (cash >= price * maxBuy) {
        shares += maxBuy;
        cash   -= price * maxBuy;
        addLog(`Bought ${maxBuy} shares @ $${price}`);
        updateUI();
    }
}

function sellShare() {
    if (inLeverage) return addLog("Cannot sell while leveraged.");
    if (shares > 0) {
        const amt = Math.min(maxBuy, shares);
        shares -= amt;
        cash   += price * amt;
        sellAmountBtn.textContent = amt;
        addLog(`Sold ${amt} shares @ $${price}`);
        updateUI();
    }
}

//----------------------------------------------------------
// LEVERAGE CONTROLS
//----------------------------------------------------------
function lockButtons() {
    ["buy-btn", "sell-btn", "long-btn", "short-btn"].forEach(id => {
        const b = document.getElementById(id);
        b.disabled = true;
        b.style.opacity = "0.3";
    });

    const closeBtn = document.getElementById("close-pos-btn");
    closeBtn.disabled = false;
    closeBtn.style.opacity = "1";
}

function unlockButtons() {
    ["buy-btn", "sell-btn", "long-btn", "short-btn"].forEach(id => {
        const b = document.getElementById(id);
        b.disabled = false;
        b.style.opacity = "1";
    });

    const closeBtn = document.getElementById("close-pos-btn");
    closeBtn.disabled = true;
    closeBtn.style.opacity = "0.3";
}

function openLeverage(side) {
    if (inLeverage) return;

    inLeverage    = true;
    levSide       = side;
    levEntry      = price;
    levFactor     = maxLeverage;
    levCollateral = cash;
    levUnrealised = 0;

    addLog(`Opened ${side.toUpperCase()} x${levFactor} @ $${levEntry} | Collateral: $${levCollateral.toFixed(2)}`);
    lockButtons();
}

function closePosition() {
    if (!inLeverage) return;

    let returnPct = (price - levEntry) / levEntry;
    if (levSide === "short") {
        returnPct = (levEntry - price) / levEntry;
    }
    let pnl = returnPct * levFactor * levCollateral;

    cash += pnl;
    levUnrealised = 0;

    addLog(`Closed ${levSide.toUpperCase()} — Realised PnL: $${pnl.toFixed(2)}`);

    inLeverage = false;
    levSide = null;
    unlockButtons();
    updateWealth();
}

//----------------------------------------------------------
// LIQUIDATION
//----------------------------------------------------------
function checkLiquidation() {
    if (!inLeverage) return;

    let returnPct = (price - levEntry) / levEntry;
    if (levSide === "short") {
        returnPct = (levEntry - price) / levEntry;
    }

    const liqLong  = -1 / levFactor;
    const liqShort =  1 / levFactor;

    if (levSide === "long" && returnPct <= liqLong) {
        addLog("💀 LONG LIQUIDATED");
        cash = 0;
        shares = 0;
        levUnrealised = 0;
        inLeverage = false;
        unlockButtons();
        rugEvent();
        return;
    }

    if (levSide === "short" && returnPct >= liqShort) {
        addLog("💀 SHORT LIQUIDATED");
        cash = 0;
        shares = 0;
        levUnrealised = 0;
        inLeverage = false;
        unlockButtons();
        rugEvent();
        return;
    }

    const displayCash = cash + (inLeverage ? levUnrealised : 0);
    const w = displayCash + shares * price;
    if (w <= 0) {
        addLog("💀 TOTAL LOSS — Game Over");
        rugEvent();
        return;
    }
}

//----------------------------------------------------------
// WEALTH + INSTANT LOSS
//----------------------------------------------------------
function updateWealth() {
    let displayCash = cash;
    if (inLeverage) displayCash += levUnrealised;

    cashUI.textContent = `$${displayCash.toFixed(2)}`;

    const w = displayCash + shares * price;
    wealthUI.textContent = `$${w.toFixed(2)}`;

    if (w <= 0) {
        rugEvent();
    }
}

//----------------------------------------------------------
// TIMER & RUG EVENT
//----------------------------------------------------------
function startTimer() {
    timerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft < 0) timeLeft = 0;
        timerUI.textContent = timeLeft;
        if (timeLeft <= 0) rugEvent();
    }, 1000);
}

let gameOver = false;

function rugEvent() {
    if (gameOver) return;
    gameOver = true;

    clearInterval(timerInterval);
    clearInterval(botInterval);

    SND_SIREN.currentTime = 0;
    SND_SIREN.play();

    timeLeft = 0;
    timerUI.textContent = "0";

    price = 0;
    priceUI.textContent = "$0.00";

    // Push final 0 into chart + redraw collapse
    priceHistory.push(0);
    if (priceHistory.length > 200) priceHistory.shift();
    drawChart();

    let displayCash = cash + (inLeverage ? levUnrealised : 0);
    let finalWealth = displayCash + shares * price;
    lastFinalWealth = finalWealth;

    let percent = ((finalWealth - 100) / 100) * 100;

    document.getElementById("popup-wealth").textContent =
        `$${finalWealth.toFixed(2)}`;
    document.getElementById("popup-return").textContent =
        (percent >= 0 ? "+" : "") + percent.toFixed(2) + "%";

    document.getElementById("popup-high").textContent =
        "$" + highestPrice.toFixed(2);
    document.getElementById("popup-low").textContent =
        "$" + lowestPrice.toFixed(2);

    document.getElementById("popup-whales-in").textContent  = totalWhaleEnters;
    document.getElementById("popup-whales-out").textContent = totalWhaleExits;
    document.getElementById("popup-megawhales").textContent = totalMegaWhales;

    document.getElementById("popup-bigup").textContent   = biggestUp.toFixed(2);
    document.getElementById("popup-bigdown").textContent = biggestDown.toFixed(2);

    document.getElementById("popup-seed").textContent =
        currentSeed !== null ? currentSeed : "-";

    document.getElementById("share-popup").style.display = "flex";
}

//----------------------------------------------------------
// UI HELPERS
//----------------------------------------------------------
function updateUI() {
    priceUI.textContent  = `$${price.toFixed(2)}`;
    sharesUI.textContent = shares;
    updateWealth();
}

function addLog(msg) {
    const p = document.createElement("p");
    p.textContent = msg;
    logBox.appendChild(p);
    logBox.scrollTop = logBox.scrollHeight;
}

//----------------------------------------------------------
// CHART
//----------------------------------------------------------
function drawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (priceHistory.length < 2) return;

    const min = Math.min(...priceHistory);
    const max = Math.max(...priceHistory);
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 2;

    for (let i = 0; i < priceHistory.length; i++) {
        const x = (i / (priceHistory.length - 1)) * canvas.width;
        const y = canvas.height - (((priceHistory[i] - min) / range) * canvas.height);

        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
    }

    ctx.stroke();

    document.getElementById("chart-y-axis").innerHTML = `
        $${max.toFixed(2)}<br>
        $${((max + min) / 2).toFixed(2)}<br>
        $${min.toFixed(2)}
    `;
    document.getElementById("chart-x-axis").innerText = "Time →";
}

//----------------------------------------------------------
// FOLLOW ON X
//----------------------------------------------------------
function followOnX() {
    window.open("https://x.com/GaiaProjectSol", "_blank");
    document.getElementById("share-popup").style.display = "none";
}

//----------------------------------------------------------
// SUPABASE LEADERBOARD
//----------------------------------------------------------
async function submitScore() {
    if (lastFinalWealth == null || currentSeed == null) {
        alert("Play a full game before submitting your score.");
        return;
    }

    const nameInput = document.getElementById("player-name");
    const nameRaw = (nameInput.value || "").trim();

    if (!nameRaw) {
        alert("Enter your name (max 10 characters).");
        return;
    }

    const name = nameRaw.slice(0, 10);

    const body = {
        name,
        score: lastFinalWealth,
        seed: currentSeed
    };

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                Prefer: "return=minimal"
            },
            body: JSON.stringify(body)
        });
        alert("Score submitted!");
        loadLeaderboard();
    } catch (err) {
        console.error("Error submitting score:", err);
        alert("Error submitting score. Check console for details.");
    }
}

async function loadLeaderboard() {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/leaderboard?select=*&order=score.desc&limit=20`,
        { headers: { apikey: SUPABASE_KEY } }
    );

    const data = await res.json();
    const list = document.getElementById("leaderboard-list");
    list.innerHTML = "";

    data.forEach((entry, index) => {
        const li = document.createElement("li");

        // Rank number (1-based)
        const rank = index + 1;

        li.innerHTML = `
            <span class="rank">#${rank}</span>
            <span class="lb-name">${entry.name}</span>
            <span class="lb-score">$${entry.score.toFixed(2)}</span>
            <span class="lb-seed">Seed ${entry.seed}</span>
        `;

        // Highlight top score
        if (rank === 1) li.classList.add("lb-top");

        list.appendChild(li);
    });
}


//----------------------------------------------------------
// START GAME
//----------------------------------------------------------
function startGame() {
    updateUI();
    botInterval = setInterval(updatePrice, 700);
    startTimer();
    loadLeaderboard();
}

window.addEventListener("DOMContentLoaded", () => {
    loadLeaderboard();
});

//----------------------------------------------------------
// LEADERBOARD (GENEAN NAME USED)
//----------------------------------------------------------
async function submitScore() {
  if (lastFinalWealth == null || currentSeed == null) {
    alert("Play a full game before submitting your score.");
    return;
  }

  const body = {
    name: currentGenean.name,
    score: lastFinalWealth,
    seed: currentSeed
  };

  await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=minimal"
    },
    body: JSON.stringify(body)
  });

  alert("Score submitted!");
  loadLeaderboard();
}
