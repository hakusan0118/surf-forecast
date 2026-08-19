const rankingEl = document.getElementById("ranking");
const forecastEl = document.getElementById("forecast");
const updatedEl = document.getElementById("updated");
const errorEl = document.getElementById("error");
const regionFilterEl = document.getElementById("region-filter");
let allLocations = [];
let spotConfig = {};


function esc(v){
  return String(v ?? "—").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function quality(rating){

  const label =
    String(
      rating || "Poor"
    );

  const classes = {
    Epic: "epic",
    Good: "good",
    Fair: "fair",
    Poor: "poor"
  };

  return [
    label,
    classes[label] || "poor"
  ];
}
function waveClass(h){
  h = num(h);
  if(h < .5) return "wave-0";
  if(h < .8) return "wave-1";
  if(h < 1.1) return "wave-2";
  if(h < 1.5) return "wave-3";
  if(h < 2.0) return "wave-4";
  return "wave-5";
}
function groupByDate(items){
  const map = new Map();
  for(const item of items){
    if(!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
  }
  return [...map.entries()];
}
function keepThreeDays(items){
  const dates = [...new Set(items.map(x => x.date))].slice(0,3);
  return items.filter(x => dates.includes(x.date));
}

function enrichLocation(location){

  const config =
    spotConfig[location.name];

  const profile =
    config
      ? {
          name:
            config.name ||
            location.name,

          region:
            config.region ||
            "",

          facing:
            config.info?.facing ||
            "—",

          kind:
            config.info?.kind ||
            "",

          level:
            config.info?.level ||
            "",

          bestTide:
            config.bestTide ||
            ""
        }
      : {
          name: location.name,
          region: "",
          facing: "—",
          kind: "",
          level: "",
          bestTide: ""
        };


  const forecast =
    keepThreeDays(
      location.forecast || []
    )
    .map(slot => {

      const backendScore =
        Number(slot.score);

      if(
        !Number.isFinite(
          backendScore
        )
      ){
        throw new Error(
          `Missing backend score: ` +
          `${location.name} ` +
          `${slot.date} ${slot.time}`
        );
      }

      if(!slot.rating){
        throw new Error(
          `Missing backend rating: ` +
          `${location.name} ` +
          `${slot.date} ${slot.time}`
        );
      }

      return {
        ...slot,
        score: backendScore,
        rating: slot.rating,
        tide_status:
          slot.tide_status ?? null
      };

    });


  const best =
    forecast
      .slice()
      .sort(
        (a,b) =>
          b.score - a.score
      )[0] || null;


  return {
    ...location,
    profile,
    forecast,
    best
  };
}
function isSurfableInDaylight(slot, daylight){

  if(
    !slot ||
    !daylight ||
    !daylight.lights_on ||
    !daylight.lights_off
  ){
    return true;
  }

  const toMinutes = value => {
    const [h, m] = String(value)
      .split(":")
      .map(Number);

    return h * 60 + m;
  };

  const time =
    toMinutes(slot.time);

  const lightsOn =
    toMinutes(daylight.lights_on);

  const lightsOff =
    toMinutes(daylight.lights_off);

  return (
    time >= lightsOn &&
    time <= lightsOff
  );
}
function renderRanking(locations){

  const dates = [...new Set(
    locations.flatMap(
      loc =>
        loc.forecast.map(
          x => x.date
        )
    )
  )]
    .sort()
    .slice(0, 3);


  rankingEl.innerHTML =
    dates.map(date => {

      const ranked =
        locations
          .map(loc => {

            const daylight =
              (loc.daylight || [])
                .find(
                  x => x.date === date
                );


            const daySlots =
              loc.forecast
                .filter(
                  x => x.date === date
                );


            const surfableSlots =
              daySlots.filter(
                x =>
                  isSurfableInDaylight(
                    x,
                    daylight
                  )
              );


            const best = (
              surfableSlots.length
                ? surfableSlots
                : daySlots
            )
              .slice()
              .sort(
                (a,b) =>
                  b.score - a.score
              )[0] || null;


            return {
              ...loc,
              dayBest: best
            };

          })
          .filter(
            loc => loc.dayBest
          )
          .sort(
            (a,b) =>
              b.dayBest.score -
              a.dayBest.score
          )
          .slice(0, 3);


      const d =
        new Date(
          date + "T00:00:00"
        );

      const dateLabel =
        `${d.getMonth()+1}月${d.getDate()}日`;


      return `
        <section class="daily-ranking">

          <div class="daily-ranking-head">

            <div>
              <div class="daily-ranking-date">
                ${dateLabel}
              </div>

              <div class="daily-ranking-title">
                最佳浪點 TOP 3
              </div>
            </div>

          </div>


          <div class="daily-ranking-grid">

            ${ranked.map((loc,i)=>{

              const b =
                loc.dayBest;

              const [label,cls] =
              quality(
                  b.rating
                );

              return `
                <article
                  class="rank-card rank-card-link"
                  data-location="${esc(loc.name)}"
                  data-date="${esc(date)}"
                  role="button"
                  tabindex="0"
                >

                  <div class="rank-no">
                    #${i+1}
                  </div>

                  <div class="rank-title">
                    ${esc(loc.profile.name)}
                  </div>

                  <div class="rank-meta">
                    ${esc(loc.profile.region)}
                  </div>

                  <div class="score-row">

                    <div class="score">
                      ${b.score ?? 0}
                    </div>

                    <span class="badge ${cls}">
                      ${label}
                    </span>

                  </div>

                  <div class="best-time">
                    最佳 ${esc(b.time)}
                  </div>

                  <div class="rank-stats">

                    <span class="chip">
                      ${esc(b.wave_height)} m
                    </span>

                    <span class="chip">
                      ${esc(b.wave_period)} s
                    </span>

                    <span class="chip">
                      ${esc(b.wind_kts)} kt
                    </span>

                  </div>

                </article>
              `;

            }).join("")}

          </div>

        </section>
      `;

    }).join("");
}

 function tideChart(
  tideDay,
  chartId,
  bestTime,
  allTides = []
){

  const dayEvents =
    (tideDay?.events || [])
      .map(event => ({
        ...event,
        event_date: tideDay?.date
      }));

  const allEvents =
    (allTides || [])
      .flatMap(day =>
        (day.events || []).map(event => ({
          ...event,
          event_date: day.date
        }))
      )
      .filter(event => event.datetime)
      .sort(
        (a, b) =>
          Date.parse(a.datetime) -
          Date.parse(b.datetime)
      );

  let events = dayEvents.slice();

  if(
    events.length === 1 &&
    tideDay?.date
  ){

    const currentTime =
      Date.parse(events[0].datetime);

    const previousEvent =
      allEvents
        .filter(
          event =>
            Date.parse(event.datetime) <
            currentTime
        )
        .at(-1);

    const nextEvent =
      allEvents.find(
        event =>
          Date.parse(event.datetime) >
          currentTime
      );

    events = [
      previousEvent,
      ...events,
      nextEvent
    ].filter(Boolean);
  }

  const dayStart =
    tideDay?.date
      ? Date.parse(
          `${tideDay.date}T00:00:00+08:00`
        )
      : null;

  events = events
    .map(event => ({
      ...event,

      chart_minute:
        dayStart !== null &&
        event.datetime
          ? (
              Date.parse(event.datetime) -
              dayStart
            ) / 60000
          : null
    }))
    .sort(
      (a, b) =>
        Date.parse(a.datetime) -
        Date.parse(b.datetime)
    );

  if(events.length < 2){
    return `
      <div class="tide-card">
        <div class="tide-card-head">
          <span>🌊 潮汐</span>
          <span class="tide-range">暫無資料</span>
        </div>
      </div>
    `;
  }
   const isMobile =
    window.matchMedia(
      "(max-width: 560px)"
    ).matches;

  const width =
    isMobile ? 360 : 720;

  const height = 170;

  const padX =
    isMobile ? 28 : 38;

  const padTop = 28;
  const padBottom = 60;
  const values = events
    .map(e => Number(e.height_cm))
    .filter(Number.isFinite);

  const minH = Math.min(...values);
  const maxH = Math.max(...values);

  const range = Math.max(
    1,
    maxH - minH
  );

  const minutes = time => {
    const [h,m] = String(time)
      .split(":")
      .map(Number);

    return h * 60 + m;
  };

  const eventMinute = event =>
    Number.isFinite(event.chart_minute)
      ? event.chart_minute
      : minutes(event.time);

  const firstEventMinute =
    eventMinute(events[0]);

  const lastEventMinute =
    eventMinute(
      events[events.length - 1]
    );

  const chartTimeRange =
    Math.max(
      1,
      lastEventMinute -
      firstEventMinute
    );

  const hasCrossDayEvent =
    events.some(
      event =>
        eventMinute(event) < 0 ||
        eventMinute(event) >= 1440
    );

  const xForMinute = timeMinute => {

    if(
      isMobile ||
      hasCrossDayEvent
    ){
      return (
        padX +
        (
          (
            timeMinute -
            firstEventMinute
          ) /
          chartTimeRange
        ) *
        (width - padX * 2)
      );
    }

    return (
      padX +
      (timeMinute / 1440) *
      (width - padX * 2)
    );
  };

  const xFor = time =>
    xForMinute(minutes(time));

  const yFor = value =>
    padTop +
    ((maxH - value) / range) *
    (height - padTop - padBottom);

  const points = events.map(e => ({
    ...e,
    value: Number(e.height_cm),
    x: xForMinute(eventMinute(e)),
    y: yFor(Number(e.height_cm))
  }));
  const bestX =
  bestTime
    ? xFor(bestTime)
    : null;


const bestMarker =
  bestX !== null
    ? `
      <g class="tide-best-marker">

        <line
          x1="${bestX}"
          y1="18"
          x2="${bestX}"
          y2="${height - padBottom + 8}"
          class="tide-best-line"
        />

        <text
          x="${bestX}"
          y="13"
          text-anchor="middle"
          class="tide-best-label">
          BEST ${esc(bestTime)}
        </text>

      </g>
    `
    : "";

  // 使用水平控制點製造自然漲退潮曲線
  let path = `
    M ${points[0].x} ${points[0].y}
  `;

  for(let i = 1; i < points.length; i++){

    const a = points[i - 1];
    const b = points[i];

    const midX = (a.x + b.x) / 2;

    path += `
      C
      ${midX} ${a.y}
      ${midX} ${b.y}
      ${b.x} ${b.y}
    `;
  }


  const bottomY =
    height - padBottom + 8;

  const areaPath = `
    ${path}
    L ${points[points.length - 1].x} ${bottomY}
    L ${points[0].x} ${bottomY}
    Z
  `;


  const markers = points.map(p => {

    const isHigh =
      p.type === "滿潮";

    const datePrefix =
      p.event_date < tideDay.date
        ? "前日"
        : p.event_date > tideDay.date
          ? "翌日"
          : "";

    const labelY =
      isHigh
        ? p.y + 20
        : Math.max(18, p.y - 12);

    const heightM =
      (p.value / 100).toFixed(2);

    return `
      <g class="tide-point">

        <circle
          cx="${p.x}"
          cy="${p.y}"
          r="5"
          class="${isHigh ? "tide-high-dot" : "tide-low-dot"}"
        />

        <text
          x="${p.x}"
          y="${labelY}"
          text-anchor="middle"
          class="tide-height-label">
          ${heightM}m
        </text>
        
        <text
          x="${p.x}"
          y="${height - 22}"
          text-anchor="middle"
          class="tide-time-label">
          ${esc(p.time)}
        </text>

        <text
          x="${p.x}"
          y="${height - 7}"
          text-anchor="middle"
          class="tide-type-label ${isHigh ? "tide-type-high" : "tide-type-low"}">
          ${esc(`${datePrefix}${p.type}`)}
        </text>

      </g>
    `;
  }).join("");


  const safeId =
    `tide-${chartId}`
      .replace(/[^a-zA-Z0-9_-]/g, "");


  return `
    <div class="tide-card">

      <div class="tide-card-head">

        <div class="tide-card-title">
          <span>🌊</span>
          <strong>潮汐</strong>
        </div>

        <span class="tide-range">
          ${esc(tideDay.tide_range)}潮
        </span>

      </div>


      <div class="tide-chart-wrap">

        <svg
          class="tide-chart"
          viewBox="0 0 ${width} ${height}"
          preserveAspectRatio="none"
          role="img"
          aria-label="潮汐變化圖">

          <defs>

            <linearGradient
              id="${safeId}-fill"
              x1="0"
              y1="0"
              x2="0"
              y2="1">

              <stop
                offset="0%"
                stop-color="#43bed8"
                stop-opacity=".32"
              />

              <stop
                offset="100%"
                stop-color="#43bed8"
                stop-opacity=".03"
              />

            </linearGradient>

          </defs>


          <path
            d="${areaPath}"
            fill="url(#${safeId}-fill)"
            class="tide-area"
          />

          <path
            d="${path}"
            class="tide-line"
          />
          ${bestMarker}
          ${markers}

        </svg>

      </div>

    </div>
  `;
}
function dayGrid(
  date,
  items,
  daylight,
  tideDay,
  allTides,
  chartId
){
  const slots = items
    .map(x => x.time)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  const map = Object.fromEntries(
    items.map(x => [x.time, x])
  );

const light =
  daylight || {};

const surfableItems =
  items.filter(
    x => isSurfableInDaylight(
      x,
      light
    )
  );

const dayBest = (
  surfableItems.length
    ? surfableItems
    : items
)
  .slice()
  .sort(
    (a,b) =>
      b.score - a.score
  )[0];

const daylightHtml = `
  <div class="daylight-row">

    <span class="daylight-chip daylight-on">
      <span class="daylight-icon">🌅</span>
      <span>
        <strong>開燈</strong>
        ${esc(light.lights_on)}
      </span>
    </span>

    <span class="daylight-chip daylight-off">
      <span class="daylight-icon">🌙</span>
      <span>
        <strong>關燈</strong>
        ${esc(light.lights_off)}
      </span>
    </span>

  </div>
`;

  const row = (label, render, cls="") =>
    `<div class="cell label">${label}</div>` +
    slots.map(t=>{
      const x = map[t];

      if(!x){
        return `<div class="cell ${cls} muted">—</div>`;
      }

      const isBest =
        dayBest &&
        x.date === dayBest.date &&
        x.time === dayBest.time;

      return `
        <div class="cell ${cls} ${isBest ? "best-slot" : ""}">
          ${render(x)}
        </div>
      `;
    }).join("");

  return `<section class="day-section">

  <div class="day-head">
    <div class="day-title">${esc(date)}</div>
    <div class="day-best">
      最佳 ${esc(dayBest?.time)} · ${dayBest?.score ?? 0} 分
    </div>
  </div>

  ${tideChart(
    tideDay,
    chartId,
    dayBest?.time,
    allTides
  )}
    <div class="forecast-grid" style="--slot-count:${slots.length}">
      <div class="cell label headcell">項目</div>
      ${slots.map(t=>{

  const isBestTime =
    dayBest &&
    t === dayBest.time;

  return `
    <div class="cell headcell ${isBestTime ? "best-head" : ""}">
      ${t}
    </div>
  `;

}).join("")}
      ${row("浪高",x=>`<div class="${waveClass(x.wave_height)}" style="margin:-10px -8px;padding:10px 6px"><span class="metric-main">${esc(x.wave_height)} m</span></div>`)}
      ${row("週期",x=>`<span class="metric-period">${esc(x.wave_period)} s</span>`)}
      ${row("風速",x=>`${esc(x.wind_kts)} kt`)}
      ${row("風向",x=>`<span class="direction">${esc(x.wind_direction)}</span>`)}
      ${row("浪向",x=>`<span class="direction">${esc(x.wave_direction)}</span>`)}
      ${row("評分",x=>{const [q,c]=quality(x.rating);return `<span class="score-mini badge ${c}">${x.score}</span>`})}
    </div>
  </section>`;
}
function updateSpotDashboard(
  card,
  loc,
  date
){

  const daylight =
    (loc.daylight || [])
      .find(
        x => x.date === date
      );


  const daySlots =
    loc.forecast.filter(
      x => x.date === date
    );


  const surfableSlots =
    daySlots.filter(
      x =>
        isSurfableInDaylight(
          x,
          daylight
        )
    );


  const b = (
    surfableSlots.length
      ? surfableSlots
      : daySlots
  )
    .slice()
    .sort(
      (a,b) =>
        b.score - a.score
    )[0];


  if(!b){
    return;
  }

  const [q,c] =
    quality(
      b.rating
    );

  const timeEl =
    card.querySelector(
      ".best-dashboard-time"
    );

  const scoreWrap =
    card.querySelector(
      ".best-dashboard-score"
    );

  const tiles =
    card.querySelectorAll(
      ".best-tile"
    );


  if(timeEl){
    timeEl.textContent =
      b.time || "—";
  }


  if(scoreWrap){

    scoreWrap.innerHTML = `
      <span>${b.score ?? 0}</span>
      <span class="badge ${c}">
        ${q}
      </span>
    `;

  }


  if(tiles[0]){

    tiles[0]
      .querySelector(
        ".best-tile-value"
      )
      .innerHTML = `
        ${esc(b.wave_height)}
        <small>m</small>
      `;

  }


  if(tiles[1]){

    tiles[1]
      .querySelector(
        ".best-tile-value"
      )
      .innerHTML = `
        ${esc(b.wave_period)}
        <small>s</small>
      `;

  }


  if(tiles[2]){

    tiles[2]
      .querySelector(
        ".best-tile-value"
      )
      .innerHTML = `
        ${esc(b.wind_kts)}
        <small>kt</small>
      `;

  }


  if(tiles[3]){

    tiles[3]
      .querySelector(
        ".best-tile-value"
      )
      .textContent =
        b.tide_status || "—";

  }


  if(tiles[4]){

    tiles[4]
      .querySelector(
        ".best-tile-value"
      )
      .textContent =
        b.wind_direction || "—";

  }


  if(tiles[5]){

    tiles[5]
      .querySelector(
        ".best-tile-value"
      )
      .textContent =
        b.wave_direction || "—";

  }

}
function renderSpots(locations){
  forecastEl.innerHTML = locations.map((loc, spotIndex)=>{
    const p = loc.profile;

    const today = [...new Set(loc.forecast.map(x => x.date))]
      .sort()[0];

   const todaySlots = loc.forecast
  .filter(x => x.date === today);

const todayDaylight = (loc.daylight || [])
  .find(x => x.date === today);

const surfableTodaySlots = todaySlots
  .filter(
    x => isSurfableInDaylight(
      x,
      todayDaylight
    )
  );

const b = (
  surfableTodaySlots.length
    ? surfableTodaySlots
    : todaySlots
)
  .slice()
  .sort(
    (a,b) =>
      b.score - a.score
  )[0] || {};

    const [q,c] = quality(b.rating);
    const days = groupByDate(loc.forecast);

    const tabs = days.map(([date],i)=>{
  const d = new Date(date + "T00:00:00");
  const dateLabel = `${d.getMonth()+1}/${d.getDate()}`;

  const dayLabel =
    i === 0 ? "今天" :
    i === 1 ? "明天" :
    "後天";

  return `
    <button
      class="date-tab ${i===0 ? "active" : ""}"
      data-spot="${spotIndex}"
      data-day="${i}"
      data-date="${esc(date)}">

      <span class="date-tab-day">${dayLabel}</span>
      <span class="date-tab-date">${dateLabel}</span>

    </button>
  `;
}).join("");

    const dayPanels = days.map(([date,items],i)=>{

  const daylight = (loc.daylight || [])
    .find(x => x.date === date);
  const tideDay = (loc.tides || [])
  .find(x => x.date === date);
      
  return `
    <div
      class="day-panel"
      data-spot="${spotIndex}"
      data-day="${i}"
      data-date="${esc(date)}"
      ${i===0 ? "" : "hidden"}>

         ${dayGrid(
        date,
        items,
        daylight,
        tideDay,
        loc.tides || [],
        `${spotIndex}-${i}-${date}`
      )}

    </div>
  `;
}).join("");
    

    return `
      <details
  class="spot-card"
  data-location="${esc(loc.name)}"
>
        <summary class="spot-summary">
         <div class="spot-head">

  <div>
    <div class="spot-name">${esc(p.name)}</div>
    <div class="spot-region">${esc(p.region)}</div>
  </div>

  <div class="spot-expand-icon">
    <span></span>
  </div>

</div>

          <div class="best-dashboard">

  <div class="best-dashboard-head">
    <div>
      <div class="best-dashboard-label">
        建議下水
      </div>

      <div class="best-dashboard-time">
        ${esc(b.time)}
      </div>
    </div>

    <div class="best-dashboard-score">
      <span>${b.score ?? 0}</span>
      <span class="badge ${c}">${q}</span>
    </div>
  </div>


  <div class="best-dashboard-grid">

    <div class="best-tile">
      <div class="best-tile-icon">🌊</div>
      <div class="best-tile-value">
        ${esc(b.wave_height)}
        <small>m</small>
      </div>
      <div class="best-tile-label">浪高</div>
    </div>


    <div class="best-tile">
      <div class="best-tile-icon">⏱</div>
      <div class="best-tile-value">
        ${esc(b.wave_period)}
        <small>s</small>
      </div>
      <div class="best-tile-label">週期</div>
    </div>


    <div class="best-tile">
      <div class="best-tile-icon">💨</div>
      <div class="best-tile-value">
        ${esc(b.wind_kts)}
        <small>kt</small>
      </div>
      <div class="best-tile-label">風速</div>
    </div>


    <div class="best-tile best-tile-tide">
      <div class="best-tile-icon">🌙</div>
      <div class="best-tile-value best-tile-text">
        ${esc(b.tide_status || "—")}
      </div>
      <div class="best-tile-label">
        潮汐 · 最佳 ${esc(p.bestTide)}
      </div>
    </div>


    <div class="best-tile">
      <div class="best-tile-icon">🧭</div>
      <div class="best-tile-value best-tile-text">
        ${esc(b.wind_direction)}
      </div>
      <div class="best-tile-label">風向</div>
    </div>


    <div class="best-tile">
      <div class="best-tile-icon">↗</div>
      <div class="best-tile-value best-tile-text">
        ${esc(b.wave_direction)}
      </div>
      <div class="best-tile-label">浪向</div>
    </div>

  </div>

</div>
        </summary>

        <div class="spot-detail">

          <div class="date-tabs">
            ${tabs}
          </div>

          ${dayPanels}

        </div>
      </details>
    `;
  }).join("");

  document
  .querySelectorAll(".date-tab")
  .forEach(btn => {

    btn.addEventListener(
      "click",
      e => {

        e.preventDefault();


        const spot =
          btn.dataset.spot;

        const day =
          btn.dataset.day;

        const date =
          btn.dataset.date;


        // -----------------------------
        // 切換這個浪點的日期
        // -----------------------------

        document
          .querySelectorAll(
            `.date-tab[data-spot="${spot}"]`
          )
          .forEach(
            x =>
              x.classList.remove(
                "active"
              )
          );


        btn.classList.add(
          "active"
        );


        document
          .querySelectorAll(
            `.day-panel[data-spot="${spot}"]`
          )
          .forEach(panel => {

            panel.hidden =
              panel.dataset.day !== day;

          });


        // -----------------------------
        // 同步上方 TOP 3
        // -----------------------------

       const card =
  btn.closest(
    ".spot-card"
  );

const locationName =
  card?.dataset.location;

const loc =
  allLocations.find(
    x =>
      x.name === locationName
  );


if(card && loc){

  updateSpotDashboard(
    card,
    loc,
    date
  );

}
      }

    );

  });
}
function openSpotForecast(locationName, date){

  const card = [...document.querySelectorAll(".spot-card")]
    .find(
      el =>
        el.dataset.location === locationName
    );

  if(!card){
    return false;
  }


  // 展開浪點
  card.open = true;


  // 找指定日期
  const tabs =
    [...card.querySelectorAll(".date-tab")];

  const targetTab =
    tabs.find(
      tab =>
        tab.dataset.date === date
    );


  if(targetTab){

    tabs.forEach(
      tab =>
        tab.classList.remove("active")
    );

    targetTab.classList.add("active");


    const targetDay =
      targetTab.dataset.day;

    card
      .querySelectorAll(".day-panel")
      .forEach(panel => {

        panel.hidden =
          panel.dataset.day !== targetDay;

      });
    const loc =
      allLocations.find(
        x =>
          x.name === locationName
      );

    if(loc){

      updateSpotDashboard(
        card,
        loc,
        date
      );

}
  }


  // 稍微等 details 展開後再捲動
  setTimeout(() => {

  card.scrollIntoView({
    behavior:"smooth",
    block:"start"
  });


  card.classList.remove(
    "spot-jump-highlight"
  );

  void card.offsetWidth;

  card.classList.add(
    "spot-jump-highlight"
  );


  setTimeout(() => {

    card.classList.remove(
      "spot-jump-highlight"
    );

  }, 1200);


}, 80);


  return true;
}
function bindRankingClicks(){

  document
    .querySelectorAll(
      ".rank-card-link"
    )
    .forEach(card => {

      const go = () => {

        const locationName =
          card.dataset.location;

        const date =
          card.dataset.date;


        let success =
          openSpotForecast(
            locationName,
            date
          );


        // 如果目前地區篩選把該浪點隱藏，
        // 自動恢復「全部」
        if(!success){

          renderSpots(
            allLocations
          );


          regionFilterEl
            .querySelectorAll(
              ".region-btn"
            )
            .forEach(
              x =>
                x.classList.remove(
                  "active"
                )
            );


          const allButton =
            regionFilterEl.querySelector(
              '[data-region="全部"]'
            );


          if(allButton){

            allButton
              .classList.add(
                "active"
              );

          }


          openSpotForecast(
            locationName,
            date
          );

        }

      };


      card.addEventListener(
        "click",
        go
      );


      card.addEventListener(
        "keydown",
        e => {

          if(
            e.key === "Enter" ||
            e.key === " "
          ){

            e.preventDefault();

            go();

          }

        }
      );

    });

}
Promise.all([
  fetch("./spots.json", {
    cache: "no-store"
  }).then(r => {
    if(!r.ok){
      throw new Error(
        `spots.json HTTP ${r.status}`
      );
    }
    return r.json();
  }),

  fetch("./data/surf_forecast.json", {
    cache: "no-store"
  }).then(r => {
    if(!r.ok){
      throw new Error(
        `forecast HTTP ${r.status}`
      );
    }
    return r.json();
  })
])
.then(([spots, data]) => {

  spotConfig = spots || {};


  updatedEl.textContent =
    data.updated
      ? `資料更新：${new Date(
          data.updated
        ).toLocaleString(
          "zh-TW",
          {hour12:false}
        )}`
      : "資料更新時間未知";


  allLocations =
    (data.locations || [])
      .map(enrichLocation);


  renderRanking(
    allLocations
  );

  renderSpots(
    allLocations
  );

  bindRankingClicks();


  regionFilterEl
    .querySelectorAll(
      ".region-btn"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () => {

          const region =
            btn.dataset.region;


          regionFilterEl
            .querySelectorAll(
              ".region-btn"
            )
            .forEach(x =>
              x.classList.remove(
                "active"
              )
            );


          btn.classList.add(
            "active"
          );


          const filtered =
            region === "全部"
              ? allLocations
              : allLocations.filter(
                  loc =>
                    spotConfig[
                      loc.name
                    ]?.area === region
                );


          renderSpots(
            filtered
          );

        }
      );

    });

})
.catch(err => {

  updatedEl.textContent =
    "資料載入失敗";

  errorEl.hidden = false;

  errorEl.textContent =
    `無法讀取資料：${err.message}`;

});
// =========================================================
// Surfer cursor — desktop only
// =========================================================

function initSurferCursor(){

  const canUseSurferCursor =
    window.matchMedia(
      "(hover:hover) and " +
      "(pointer:fine) and " +
      "(prefers-reduced-motion:no-preference)"
    ).matches;

  if(!canUseSurferCursor){
    return;
  }

  const surferCursor =
    document.createElement("div");

  surferCursor.className =
    "surf-cursor";

  surferCursor.setAttribute(
    "aria-hidden",
    "true"
  );

  surferCursor.innerHTML =
    '<span class="surf-cursor-rider">🏄</span>';

  document.body.appendChild(
    surferCursor
  );

  document.body.classList.add(
    "surf-cursor-enabled"
  );


  let targetX = -100;
  let targetY = -100;

  let currentX = -100;
  let currentY = -100;

  let previousX = null;
  let previousDirection = 0;
  let lastCutbackTime = 0;


  function playCutback(){

    surferCursor.classList.remove(
      "is-cutting-back"
    );

    void surferCursor.offsetWidth;

    surferCursor.classList.add(
      "is-cutting-back"
    );

  }


  surferCursor.addEventListener(
    "animationend",
    () => {

      surferCursor.classList.remove(
        "is-cutting-back"
      );

    }
  );


  window.addEventListener(
    "pointermove",
    event => {

      targetX = event.clientX;
      targetY = event.clientY;

      surferCursor.classList.add(
        "is-visible"
      );


      if(previousX !== null){

        const movementX =
          event.clientX - previousX;

        if(Math.abs(movementX) >= 4){

          const newDirection =
            movementX > 0
              ? 1
              : -1;


          surferCursor.classList.toggle(
            "facing-left",
            newDirection < 0
          );


          const now =
            performance.now();

          if(
            previousDirection !== 0 &&
            newDirection !==
              previousDirection &&
            now - lastCutbackTime > 650
          ){

            playCutback();

            lastCutbackTime = now;

          }


          previousDirection =
            newDirection;

        }

      }


      previousX =
        event.clientX;

    },
    {passive:true}
  );


  document.addEventListener(
    "mouseleave",
    () => {

      surferCursor.classList.remove(
        "is-visible"
      );

      previousX = null;
      previousDirection = 0;

    }
  );


  function animateSurfer(){

    currentX +=
      (targetX - currentX) * 0.28;

    currentY +=
      (targetY - currentY) * 0.28;

    surferCursor.style.transform =
      `translate3d(
        ${currentX}px,
        ${currentY}px,
        0
      ) translate(-50%, -50%)`;

    requestAnimationFrame(
      animateSurfer
    );

  }


  animateSurfer();

}


initSurferCursor();
