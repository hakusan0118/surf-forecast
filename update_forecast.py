import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


# =========================================================
# Project paths
# =========================================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

PRIVATE_SCORING_DIR = os.path.join(
    BASE_DIR,
    "private-scoring"
)


# =========================================================
# Private scoring engine
# =========================================================

if not os.path.isdir(
    PRIVATE_SCORING_DIR
):
    raise SystemExit(
        "Private scoring directory not found"
    )

sys.path.insert(
    0,
    PRIVATE_SCORING_DIR
)

try:
    from scoring import (
        load_rules,
        score_slot,
    )

except ImportError as exc:
    raise SystemExit(
        f"Unable to load private scoring engine: {exc}"
    )


PRIVATE_RULES = load_rules()


# =========================================================
# CWA API
# =========================================================

API_KEY = os.environ.get(
    "CWA_API_KEY",
    ""
).strip()

if not API_KEY:
    raise SystemExit(
        "Missing CWA_API_KEY"
    )


# =========================================================
# CWA 資料集
# =========================================================

SURF_DATA_ID = "F-D0047-095"
TIDE_DATA_ID = "F-A0021-001"
DAYLIGHT_DATA_ID = "A-B0062-001"


def make_url(data_id):
    return (
        "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/"
        f"{data_id}"
        f"?Authorization={urllib.parse.quote(API_KEY)}"
        "&format=JSON"
    )


SURF_URL = make_url(SURF_DATA_ID)
TIDE_URL = make_url(TIDE_DATA_ID)
DAYLIGHT_URL = make_url(DAYLIGHT_DATA_ID)


# =========================================================
# 浪點設定
# 自動從 spots.json 讀取
# =========================================================

SPOTS_FILE = os.path.join(
    os.path.dirname(__file__),
    "spots.json"
)

with open(
    SPOTS_FILE,
    "r",
    encoding="utf-8"
) as f:
    SPOTS = json.load(f)


TARGETS = []

for internal_name, spot in SPOTS.items():

    cwa = spot.get("cwa", {})

    TARGETS.append(
        (
            cwa["geocode"],
            cwa["coastalId"],
            internal_name,
            cwa["county"]
        )
    )

# =========================================================
# 共用
# =========================================================

def download_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "surf-forecast-github-actions"
        }
    )

    with urllib.request.urlopen(
        req,
        timeout=90
    ) as response:
        raw = response.read()

    try:
        return json.loads(
            raw.decode("utf-8-sig")
        )

    except Exception:
        preview = raw[:500].decode(
            "utf-8",
            errors="replace"
        )

        raise RuntimeError(
            f"CWA response was not valid JSON: {preview}"
        )


def as_list(value):
    if value is None:
        return []

    if isinstance(value, list):
        return value

    return [value]


def parse_dt(text):
    return datetime.fromisoformat(text)


# =========================================================
# 浪況資料
# =========================================================

def find_element(
    weather_elements,
    property_name
):
    for element in weather_elements or []:

        times = element.get("Time") or []

        if not times:
            continue

        value = (
            times[0].get("ElementValue") or {}
        )

        if property_name in value:
            return element

    return None


def by_time(element):
    result = {}

    if not element:
        return result

    for row in element.get("Time") or []:
        result[row.get("DataTime")] = (
            row.get("ElementValue") or {}
        )

    return result


# =========================================================
# 潮汐資料
# =========================================================

def find_tide_locations(obj):
    """
    找出 CWA 潮汐資料中的 Location。
    """

    found = []

    def walk(node):

        if isinstance(node, dict):

            if (
                "LocationId" in node
                and "TimePeriods" in node
            ):
                found.append(node)

            for value in node.values():
                walk(value)

        elif isinstance(node, list):

            for value in node:
                walk(value)

    walk(obj)

    return found


def extract_tides(
    location,
    wanted_dates
):
    """
    輸出預報三天，並額外保留前後一天的潮汐，
    讓跨午夜的潮汐判定仍有前後兩個極值。

    潮高使用 AboveLocalMSL，
    即相對當地平均海平面，單位 cm。
    """

    output = []

    periods = (
        location.get("TimePeriods") or {}
    )

    daily_rows = as_list(
        periods.get("Daily")
    )

    daily_rows.sort(
        key=lambda row: row.get("Date") or ""
    )

    wanted_set = set(wanted_dates)

    wanted_indexes = [
        index
        for index, daily in enumerate(daily_rows)
        if daily.get("Date") in wanted_set
    ]

    if not wanted_indexes:
        return output

    first_index = max(
        0,
        min(wanted_indexes) - 1
    )

    last_index = min(
        len(daily_rows) - 1,
        max(wanted_indexes) + 1
    )

    context_rows = daily_rows[
        first_index:last_index + 1
    ]

    for daily in context_rows:

        date = daily.get("Date")

        if not date:
            continue

        events = []

        for event in as_list(
            daily.get("Time")
        ):

            dt_text = event.get("DateTime")

            if not dt_text:
                continue

            try:
                dt = parse_dt(dt_text)

            except Exception:
                continue

            heights = (
                event.get("TideHeights") or {}
            )

            height_cm = heights.get(
                "AboveLocalMSL"
            )

            events.append({
                "time": dt.strftime("%H:%M"),
                "datetime": dt_text,
                "type": event.get("Tide"),
                "height_cm": height_cm,
            })

        events.sort(
            key=lambda x: x["datetime"]
        )

        output.append({
            "date": date,

            "lunar_date":
                daily.get("LunarDate"),

            "tide_range":
                daily.get("TideRange"),

            "events": events,
        })

    output.sort(
        key=lambda x: x["date"]
    )

    return output


# =========================================================
# 開燈 / 關燈資料
# =========================================================

def extract_daylight_records(obj):
    """
    A-B0062-001 為縣市級逐日資料。

    這裡用遞迴方式處理 JSON，
    找到：
    CountyName
    Date
    BeginCivilTwilightTime
    EndCivilTwilightTime

    BeginCivilTwilightTime = 開燈
    EndCivilTwilightTime   = 關燈
    """

    records = []

    def walk(node, county=None):

        if isinstance(node, dict):

            local_county = (
                node.get("CountyName")
                or county
            )

            if (
                node.get("Date")
                and node.get(
                    "BeginCivilTwilightTime"
                )
                and node.get(
                    "EndCivilTwilightTime"
                )
            ):
                records.append({
                    "county": local_county,
                    "date": node.get("Date"),

                    "lights_on":
                        node.get(
                            "BeginCivilTwilightTime"
                        ),

                    "lights_off":
                        node.get(
                            "EndCivilTwilightTime"
                        ),

                    "sunrise":
                        node.get("SunRiseTime"),

                    "sunset":
                        node.get("SunSetTime"),
                })

            for value in node.values():
                walk(
                    value,
                    local_county
                )

        elif isinstance(node, list):

            for value in node:
                walk(
                    value,
                    county
                )

    walk(obj)

    return records


def build_daylight_index(records):
    """
    建立：
    (縣市, 日期) -> 日照資料
    """

    result = {}

    for row in records:

        county = row.get("county")
        date = row.get("date")

        if not county or not date:
            continue

        result[(county, date)] = row

    return result


def extract_daylight(
    daylight_index,
    county,
    wanted_dates
):
    output = []

    for date in wanted_dates:

        row = daylight_index.get(
            (county, date)
        )

        if not row:
            continue

        output.append({
            "date": date,

            "lights_on":
                row.get("lights_on"),

            "lights_off":
                row.get("lights_off"),

            # 先存起來，
            # UI 暫時不一定要顯示
            "sunrise":
                row.get("sunrise"),

            "sunset":
                row.get("sunset"),
        })

    return output


# =========================================================
# 每日預報歷史
# =========================================================

HISTORY_DIR = os.path.join(
    BASE_DIR,
    "data",
    "history",
)


def update_forecast_history(output):
    os.makedirs(
        HISTORY_DIR,
        exist_ok=True,
    )

    locations_by_date = {}

    for location in output.get(
        "locations",
        []
    ):
        for slot in location.get(
            "forecast",
            []
        ):
            slot_date = slot.get("date")

            if not slot_date:
                continue

            locations_by_date.setdefault(
                slot_date,
                {}
            )

            locations_by_date[
                slot_date
            ].setdefault(
                location.get("name"),
                {
                    "name":
                        location.get("name"),

                    "geocode":
                        location.get("geocode"),

                    "county":
                        location.get("county"),

                    "forecast": [],
                }
            )

            locations_by_date[
                slot_date
            ][
                location.get("name")
            ][
                "forecast"
            ].append(slot)

    written_dates = []

    for slot_date, new_locations in (
        locations_by_date.items()
    ):
        try:
            datetime.strptime(
                slot_date,
                "%Y-%m-%d",
            )
        except ValueError:
            continue

        history_path = os.path.join(
            HISTORY_DIR,
            f"{slot_date}.json",
        )

        old_locations = {}

        try:
            with open(
                history_path,
                "r",
                encoding="utf-8",
            ) as f:
                previous_history = (
                    json.load(f)
                )

            old_locations = {
                location.get("name"):
                    location

                for location in (
                    previous_history.get(
                        "locations",
                        []
                    )
                )

                if location.get("name")
            }

        except (
            FileNotFoundError,
            json.JSONDecodeError,
            TypeError,
        ):
            old_locations = {}

        merged_locations = {}

        for name in (
            set(old_locations)
            | set(new_locations)
        ):
            old_location = (
                old_locations.get(
                    name,
                    {}
                )
            )

            new_location = (
                new_locations.get(
                    name,
                    {}
                )
            )

            slots_by_time = {
                slot.get("time"):
                    slot

                for slot in (
                    old_location.get(
                        "forecast",
                        []
                    )
                )

                if slot.get("time")
            }

            for slot in (
                new_location.get(
                    "forecast",
                    []
                )
            ):
                if slot.get("time"):
                    slots_by_time[
                        slot.get("time")
                    ] = slot

            merged_locations[name] = {
                "name":
                    name,

                "geocode":
                    new_location.get(
                        "geocode"
                    )
                    or old_location.get(
                        "geocode"
                    ),

                "county":
                    new_location.get(
                        "county"
                    )
                    or old_location.get(
                        "county"
                    ),

                "forecast":
                    sorted(
                        slots_by_time.values(),
                        key=lambda slot:
                            slot.get(
                                "time",
                                ""
                            ),
                    ),
            }

        history_output = {
            "date":
                slot_date,

            "updated":
                output.get("updated"),

            "locations":
                sorted(
                    merged_locations.values(),
                    key=lambda location:
                        location.get(
                            "name",
                            ""
                        ),
                ),
        }

        with open(
            history_path,
            "w",
            encoding="utf-8",
        ) as f:
            json.dump(
                history_output,
                f,
                ensure_ascii=False,
                indent=2,
            )

        written_dates.append(
            slot_date
        )

        print(
            "Updated "
            f"data/history/{slot_date}.json"
        )

    # 僅保留最近90天。
    history_dates = []

    for filename in os.listdir(
        HISTORY_DIR
    ):
        if not filename.endswith(
            ".json"
        ):
            continue

        try:
            file_date = datetime.strptime(
                filename[:-5],
                "%Y-%m-%d",
            ).date()

            history_dates.append(
                (
                    file_date,
                    filename,
                )
            )

        except ValueError:
            continue

    if history_dates:
        newest_date = max(
            file_date
            for file_date, _ in (
                history_dates
            )
        )

        cutoff_date = (
            newest_date
            - timedelta(days=89)
        )

        for file_date, filename in (
            history_dates
        ):
            if file_date < cutoff_date:
                os.remove(
                    os.path.join(
                        HISTORY_DIR,
                        filename,
                    )
                )

                print(
                    "Removed expired history "
                    f"data/history/{filename}"
                )

    return written_dates


# =========================================================
# 每日清晨預報快照
# =========================================================

MORNING_HISTORY_DIR = os.path.join(
    BASE_DIR,
    "data",
    "morning_history",
)


def save_morning_forecast_snapshot(output):
    taipei_timezone = timezone(
        timedelta(hours=8)
    )

    now_taipei = datetime.now(
        taipei_timezone
    )

    # 正常排程為06:15；若GitHub Actions延遲，
    # 允許在09:00前的第一個成功執行補存。
    if not (
        6 <= now_taipei.hour < 9
    ):
        print(
            "Morning snapshot skipped "
            "(outside 06:00-09:00 Asia/Taipei)"
        )
        return None

    snapshot_date = (
        now_taipei
        .date()
        .isoformat()
    )

    os.makedirs(
        MORNING_HISTORY_DIR,
        exist_ok=True,
    )

    snapshot_path = os.path.join(
        MORNING_HISTORY_DIR,
        f"{snapshot_date}.json",
    )

    # 每日快照一旦建立便不再覆寫。
    if os.path.exists(
        snapshot_path
    ):
        print(
            "Morning snapshot already exists: "
            f"data/morning_history/{snapshot_date}.json"
        )
        return snapshot_path

    snapshot_locations = []

    for location in output.get(
        "locations",
        []
    ):
        day_slots = [
            dict(slot)

            for slot in location.get(
                "forecast",
                []
            )

            if slot.get("date")
            == snapshot_date
        ]

        if not day_slots:
            continue

        day_slots.sort(
            key=lambda slot:
                slot.get(
                    "time",
                    ""
                )
        )

        snapshot_locations.append({
            "name":
                location.get("name"),

            "geocode":
                location.get("geocode"),

            "county":
                location.get("county"),

            "forecast":
                day_slots,
        })

    snapshot_locations.sort(
        key=lambda location:
            location.get(
                "name",
                ""
            )
    )

    snapshot_output = {
        "date":
            snapshot_date,

        "snapshot_at":
            now_taipei.isoformat(
                timespec="seconds"
            ),

        "forecast_updated":
            output.get("updated"),

        "locations":
            snapshot_locations,
    }

    with open(
        snapshot_path,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            snapshot_output,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(
        "Created morning snapshot "
        f"data/morning_history/{snapshot_date}.json"
    )

    # 保留400天，足以進行完整年度分析並保有緩衝。
    cutoff_date = (
        now_taipei.date()
        - timedelta(days=399)
    )

    for filename in os.listdir(
        MORNING_HISTORY_DIR
    ):
        if not filename.endswith(
            ".json"
        ):
            continue

        try:
            file_date = datetime.strptime(
                filename[:-5],
                "%Y-%m-%d",
            ).date()

        except ValueError:
            continue

        if file_date < cutoff_date:
            os.remove(
                os.path.join(
                    MORNING_HISTORY_DIR,
                    filename,
                )
            )

            print(
                "Removed expired morning snapshot "
                f"data/morning_history/{filename}"
            )

    return snapshot_path


# =========================================================
# 主程式
# =========================================================

def main():
        # -----------------------------------------------------
    # 讀取上一版預報
    # 用來保留今天已經過去的時段
    # -----------------------------------------------------

    previous_locations = {}

    try:
        with open(
            "data/surf_forecast.json",
            "r",
            encoding="utf-8",
        ) as f:

            previous_data = json.load(f)

        previous_locations = {
            loc.get("name"): loc
            for loc in previous_data.get(
                "locations",
                []
            )
            if loc.get("name")
        }

    except Exception:
        previous_locations = {}
    # -----------------------------------------------------
    # 下載三個 dataset
    # -----------------------------------------------------

    print(
        "Downloading surf forecast..."
    )

    surf_payload = download_json(
        SURF_URL
    )


    print(
        "Downloading tide forecast..."
    )

    tide_payload = download_json(
        TIDE_URL
    )


    print(
        "Downloading daylight data..."
    )

    daylight_payload = download_json(
        DAYLIGHT_URL
    )


    # -----------------------------------------------------
    # 浪況 index
    # -----------------------------------------------------

    surf_dataset = (
        surf_payload["cwaopendata"]["Dataset"]
    )

    surf_locations = (
        surf_dataset["Locations"]["Location"]
    )

    # -----------------------------------------------------
    # 浪況沿海點 index
    # 使用 CWA ParameterSet 的 coastal point ID
    # 例如：10002040C01 = 頭城鎮沿海
    # -----------------------------------------------------

    surf_indexed = {}

    for loc in surf_locations:

        parameter_set = (
            loc.get("ParameterSet") or {}
        )

        parameters = as_list(
            parameter_set.get("Parameter")
        )

        for parameter in parameters:

            if (
                parameter.get("ParameterName")
                != "id"
            ):
                continue

            coastal_id = (
                parameter.get("ParameterValue")
            )

            if coastal_id:
                surf_indexed[coastal_id] = loc

    # -----------------------------------------------------
    # 潮汐 index
    # -----------------------------------------------------


    tide_locations = find_tide_locations(
        tide_payload
    )

    tide_indexed = {
        str(loc.get("LocationId")): loc
        for loc in tide_locations
        if loc.get("LocationId")
    }

    print(
        f"Tide locations found: "
        f"{len(tide_locations)}"
    )


    # -----------------------------------------------------
    # 日照 index
    # -----------------------------------------------------

    daylight_records = (
        extract_daylight_records(
            daylight_payload
        )
    )

    daylight_index = (
        build_daylight_index(
            daylight_records
        )
    )

    print(
        f"Daylight records found: "
        f"{len(daylight_records)}"
    )


    # -----------------------------------------------------
    # 組合
    # -----------------------------------------------------

    output_locations = []

    for (
        geocode,
        coastal_id,
        name,
        county
    ) in TARGETS:

        surf_loc = surf_indexed.get(
            coastal_id
        )

        if not surf_loc:

            print(
                f"Surf location not found: "
                f"{coastal_id} {name}",
                file=sys.stderr,
            )

            continue


        # =================================================
        # 浪況
        # =================================================

        elements = (
            surf_loc.get(
                "WeatherElement"
            ) or []
        )

        wind = find_element(
            elements,
            "WindSpeedKts"
        )

        wind_dir = find_element(
            elements,
            "WindDirection"
        )

        wave = find_element(
            elements,
            "WaveHeight"
        )

        wave_dir = find_element(
            elements,
            "WaveDirection"
        )

        period = find_element(
            elements,
            "WavePeriod"
        )


        if not all([
            wind,
            wind_dir,
            wave,
            wave_dir,
            period,
        ]):

            print(
                f"Missing weather element(s): "
                f"{geocode} {name}",
                file=sys.stderr,
            )

            continue


        wd_map = by_time(
            wind_dir
        )

        wave_map = by_time(
            wave
        )

        wave_dir_map = by_time(
            wave_dir
        )

        period_map = by_time(
            period
        )


        rows = []

        for row in (
            wind.get("Time") or []
        ):

            time_key = row.get(
                "DataTime"
            )

            if not time_key:
                continue

            dt = parse_dt(
                time_key
            )

            wv = (
                row.get(
                    "ElementValue"
                ) or {}
            )

            rows.append({
                "date":
                    dt.strftime(
                        "%Y-%m-%d"
                    ),

                "time":
                    dt.strftime(
                        "%H:%M"
                    ),

                "wind_kts":
                    wv.get(
                        "WindSpeedKts"
                    ),

                "beaufort":
                    wv.get(
                        "BeaufortScale"
                    ),

                "wind_direction":
                    wd_map
                    .get(
                        time_key,
                        {}
                    )
                    .get(
                        "WindDirection"
                    ),

                "wave_height":
                    wave_map
                    .get(
                        time_key,
                        {}
                    )
                    .get(
                        "WaveHeight"
                    ),

                "wave_direction":
                    wave_dir_map
                    .get(
                        time_key,
                        {}
                    )
                    .get(
                        "WaveDirection"
                    ),

                "wave_period":
                    period_map
                    .get(
                        time_key,
                        {}
                    )
                    .get(
                        "WavePeriod"
                    ),
            })


        # =================================================
        # 前三天
        # =================================================

        dates = []

        for row in rows:

            if (
                row["date"]
                not in dates
            ):
                dates.append(
                    row["date"]
                )

        dates = dates[:3]

        rows = [
            row
            for row in rows
            if row["date"] in dates
        ]

        # =================================================
        # 保留今天稍早已取得的預報
        # =================================================

        if dates:

            today_date = dates[0]

            previous_location = (
                previous_locations.get(name)
                or {}
            )

            previous_rows = (
                previous_location.get(
                    "forecast",
                    []
                )
            )

            old_today_rows = [
                row
                for row in previous_rows
                if row.get("date")
                == today_date
            ]


            # 舊資料先放入，
            # 再用最新 CWA 資料覆蓋同一時段
            merged = {
                (
                    row.get("date"),
                    row.get("time"),
                ): row
                for row in old_today_rows
            }

            for row in rows:

                merged[
                    (
                        row.get("date"),
                        row.get("time"),
                    )
                ] = row


            rows = sorted(
                merged.values(),
                key=lambda row: (
                    row.get("date", ""),
                    row.get("time", ""),
                ),
            )

            rows = [
                row
                for row in rows
                if row.get("date")
                in dates
            ]
        # =================================================
        # 潮汐
        # =================================================

        tide_loc = tide_indexed.get(
            geocode
        )

        tides = []

        tide_location_name = None


        if tide_loc:

            tide_location_name = (
                tide_loc.get(
                    "LocationName"
                )
            )

            tides = extract_tides(
                tide_loc,
                dates
            )

            print(
                f"Tide OK: "
                f"{name} -> "
                f"{tide_location_name}"
            )

        else:

            print(
                f"Tide location not found: "
                f"{geocode} {name}",
                file=sys.stderr,
            )
                # =================================================
        # Private backend scoring
        # =================================================

        for forecast_row in rows:

            scoring = score_slot(
                name,
                forecast_row,
                tides,
                rules=PRIVATE_RULES,
            )

            if scoring is None:
                raise RuntimeError(
                    f"Missing private scoring rule: {name}"
                )

            forecast_row.update(
                scoring
            )


        print(
            f"Scoring OK: {name} "
            f"({len(rows)} slots)"
        )



        # =================================================
        # 開燈 / 關燈
        # =================================================

        daylight = extract_daylight(
            daylight_index,
            county,
            dates
        )


        if daylight:

            print(
                f"Daylight OK: "
                f"{name} -> {county}"
            )

        else:

            print(
                f"Daylight not found: "
                f"{county} {name}",
                file=sys.stderr,
            )


        # =================================================
        # 輸出浪點
        # =================================================

        output_locations.append({

            "name": name,

            "geocode": geocode,

            "county": county,

            "forecast": rows,

            "tide_location_name":
                tide_location_name,

            "tides": tides,

            "daylight": daylight,
        })


    # =====================================================
    # 最終 JSON
    # =====================================================

    output = {

        "updated":
            surf_dataset
            .get(
                "DatasetInfo",
                {}
            )
            .get("Update")

            or surf_payload
            .get(
                "cwaopendata",
                {}
            )
            .get("Sent"),


        "source":
            SURF_DATA_ID,


        "tide_source":
            TIDE_DATA_ID,


        "tide_updated":
            tide_payload
            .get(
                "cwaopendata",
                {}
            )
            .get("Sent"),


        "daylight_source":
            DAYLIGHT_DATA_ID,


        "daylight_updated":
            daylight_payload
            .get(
                "cwaopendata",
                {}
            )
            .get("Sent"),


        "locations":
            output_locations,
    }


    # =====================================================
    # 寫檔
    # =====================================================

    os.makedirs(
        "data",
        exist_ok=True
    )


    with open(
        "data/surf_forecast.json",
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            output,
            f,
            ensure_ascii=False,
            indent=2,
        )


    print(
        "Updated "
        "data/surf_forecast.json"
    )


    update_forecast_history(
        output
    )


    save_morning_forecast_snapshot(
        output
    )


if __name__ == "__main__":
    main()
