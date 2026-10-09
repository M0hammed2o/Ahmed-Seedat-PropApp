# South African Smart Meter Catalogue (Proplyst)

**Evidence dates:** 2026-10-08 (hardware, municipal) and 2026-10-10 (platforms, Dragino/Milesight additions), live
WebSearch/WebFetch. **Source of truth in code:** `apps/admin/lib/smartUtility/meterCatalogue.ts` (what customers see)
and `providers.ts` (integration paths). Full pricing evidence and caveats: `SMART_UTILITY_HARDWARE_RESEARCH.md`.

**No hardware has been tested by Proplyst yet.** Every hardware path is therefore at most "Supported — awaiting
hardware testing". Prices are snapshots from SA retailer pages; get a written quote before purchasing.

## Classification

| Class | Meaning |
| --- | --- |
| **Verified and ready** | Proven end-to-end in Proplyst's automated tests with no hardware ambiguity |
| **Technically supported — requires hardware testing** | Adapter implemented against the vendor's published format; pinned by tests; awaiting a real device |
| **Requires supplier approval** | Needs a vendor agreement, keys or partner API access |
| **Unsupported** | No documented integration path found |

## Integration paths (how readings reach Proplyst)

| Path | Type | Public docs | Credentials / subscription | Status | Source |
| --- | --- | --- | --- | --- | --- |
| Manual reading + photo | — | n/a | none | Verified and ready | — |
| Proplyst JSON push (`generic_json`) | HTTP push, bearer token | Proplyst docs §12.3 | per-connection token (hashed) | Verified and ready | `SMART_UTILITY_ARCHITECTURE.md` |
| Milesight gateway HTTP (built-in network server) | LoRaWAN → HTTP push | Yes | token | Requires hardware testing | [Milesight decoders](https://github.com/Milesight-IoT/SensorDecoders), [UG65 MQTT/HTTP API](https://resource.milesight.com/milesight/iot/document/ug2-mqtt-api-documentation-en.pdf) |
| ChirpStack v4 HTTP integration (MIT, self-hosted) | LoRaWAN → HTTP push (`?event=up`, JSON, custom headers) | Yes | token as custom header | Requires hardware testing | [http.html](https://www.chirpstack.io/docs/chirpstack/integrations/http.html), [integration.proto](https://raw.githubusercontent.com/chirpstack/chirpstack/master/api/proto/integration/integration.proto) |
| The Things Stack webhook | LoRaWAN → HTTP push | Yes | token as webhook header (API/CLI; Console shows basic-auth option) | Requires hardware testing | [data formats](https://www.thethingsindustries.com/docs/integrations/data-formats/), [webhook proto](https://raw.githubusercontent.com/TheThingsNetwork/lorawan-stack/v3.37/api/ttn/lorawan/v3/applicationserver_web.proto) |
| Shelly Gen2+ push script | Wi-Fi → HTTP push | Yes | token | Requires hardware testing | [EMData](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EMData) |
| ThingsBoard REST (polled) | Cloud/self-hosted API | Yes | API key or user/password, **encrypted** | Requires hardware testing | [REST API](https://thingsboard.io/docs/reference/rest-api/) — 4.4+ is BSL 1.1 (commercial use free ≤100 devices with licence key) |
| Shelly Integrator API | Vendor cloud | Partner | Shelly approval | Requires supplier approval | [integrator-api](https://shelly-api-docs.shelly.cloud/integrator-api/) |
| Kamstrup READy API | Vendor cloud | Partner | READy customers only | Requires supplier approval | [api-access](https://www.kamstrup.com/insights/api-access) |
| Citiq / Recharger / Conlog / Hexing / L+G | Vendor portals | None found | — | Unsupported | research doc §3.2 |

Network-server notes: TTN Sandbox is **non-commercial only** (no SLA; 30 s airtime/10 downlinks per device per day);
The Things Stack Cloud Standard €190/month (1,000 devices), Discovery €0 (10 devices, restrictions) — read 2026-10-10.
ChirpStack is MIT-licensed and free to self-host.

## Hardware

| Manufacturer / model | Utility | SA supplier (link) | ZAR (date, VAT) | Protocol | Gateway | Remote / frequent readings | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Milesight EM300-DI + pulse-output meter | Water | [FirstShop](https://www.firstshop.co.za/products/milesight-em300-ip67-pulse-counter-em300-di-868m-188289), [MiRO](https://miro.co.za/4-iot---smart-home-milesight-milesight-sensors/6281-milesight-pulse-counter-ip67-6974225033423.html) | R1,350 / R1,491.55 (10-08, incl) | LoRaWAN | Yes (UG63-LTE R4,384.95; UG65 R8,888.35, MiRO incl) | Yes; 10-min ≈ 5-yr battery | Requires hardware testing |
| SANS 1529-1 pulse-ready 20 mm meter | Water | [The Water Company](https://watercompany.co.za/product/domestic-plastic-water-meter-pulse-ready-20mm/) | R605.48 (10-08, incl) | Pulse | Needs a counter | via counter | (meter only) |
| Shelly Plus Uni + pulse meter | Water | [Untamed Tech](https://untamedtech.co.za/product/shelly-plus-uni/) | R489 (10-08, VAT ?) | Wi-Fi | No | Yes | Requires hardware testing |
| Dragino SW3L-LB flow sensor | Water | [iotshop](https://iotshop.co.za/products/sw3l-lb-ls-lorawan-outdoor-flow-sensor) | R1,925–R2,200 (10-10, VAT ?) | LoRaWAN | Yes (Dragino LPS8v2 R4,815) | Yes | Requires hardware testing (LoRaWAN decoder not found) |
| Kamstrup flowIQ 2200 (OMS-LoRaWAN 02K73A) | Water | [UtilityPal](https://www.utilitypal.co.za/product-page/kamstrup-flowiq-2200-ultrasonic-water-meter-wireless-m-bus) | R2,500 (10-08, incl; variant not shown) | LoRaWAN (encrypted) | Yes | Yes | Requires hardware testing (+ keys) |
| Kamstrup flowIQ / MULTICAL 21 wM-Bus | Water | UtilityPal | flowIQ 3200 R7,406 (VAT ?) | wM-Bus | READy Concentrator R20,114 | Yes | Requires supplier approval |
| Sensus iPERL / 620 | Water | none found | — | proprietary / pulse (HRI) | — | — | Unsupported (620+HRI → EM300-DI path) |
| Shelly Pro 3EM-120A | Electricity 3-ph | [tech.co.za](https://tech.co.za/product/shelly-pro-3em-120a-relay/) | R3,029 EFT (10-08, incl) | Wi-Fi/LAN | No | Yes | Requires hardware testing (monitoring-grade) |
| Shelly Pro EM-50 / EM Gen3 | Electricity 1-ph | [tech.co.za](https://tech.co.za/product/shelly-pro-em-50-din-rail-mountable-two-channel-single-phase-energy-meter/), [Lite-Glo](https://www.liteglo.co.za/shop/shelly-em-gen3-50a-ct-energy-meter/) | R1,989 / R1,575 (10-08) | Wi-Fi | No | Yes | Requires hardware testing (monitoring-grade) |
| Eastron SDM120M / SDM630 + Modbus gateway | Electricity | [UtilityPal](https://www.utilitypal.co.za/eastron), [Haultron](https://www.haultron.co.za/products/eastron-din-rail-mounted-three-phase-ct-sdm630mct) | ≈R1,070 (box-of-100 derived); SDM630MCT R2,415 incl | Modbus RTU → HTTP | Teltonika TRB246 R3,770 (out of stock) | Yes | Requires hardware testing (MID) |
| CHINT DDSU666 / DTSU666 + gateway | Electricity | [Lite-Glo](https://www.liteglo.co.za/shop/chint-ddsu666-single-phase-din-rail-kilowatt-meter/), [Enway](https://www.enway.co.za/chint-energy-meter-DTSU666) | R1,725 / R3,448.85 incl | Modbus RTU | Yes | Yes | Requires hardware testing |
| Dragino RS485-LN / -LB (+ Modbus meter) | Electricity | [iotshop](https://iotshop.co.za/products/rs485-ln-rs485-modbus-to-lorawan-converter) | R1,475 / from R1,485 (10-10, VAT ?) | Modbus→LoRaWAN | Yes | Yes | Requires hardware testing |
| Milesight CT101 / CT103 / CTH01 | Electricity | [MiRO](https://miro.co.za/4-iot---smart-home-milesight-milesight-sensors/7488-milesight-smart-current-transformer-mls-snsr-ct101-6976274567461.html) | R2,297.70 / R2,678.35 / R9,702.55 (10-10, incl) | LoRaWAN | Yes | Yes | Requires hardware testing (monitoring-grade) |
| Milesight UC300 / UC501 Modbus controllers | Electricity | [MiRO](https://miro.co.za/654-4-iot---smart-home-milesight-milesight-controllers) | R3,230.35 / R4,402.20 incl | Modbus→LoRaWAN | Yes | Yes | Requires hardware testing |
| Schneider iEM3155 | Electricity 3-ph | [Lite-Glo](https://www.liteglo.co.za/shop/schneider-acti9-a9mem3155-3-pole-63amp-energy-meter/) | R7,210 | Modbus RTU | Yes | Yes | Requires hardware testing (via JSON gateway) |
| Shelly Cloud Integrator | Electricity | — | — | Cloud | — | — | Requires supplier approval |
| Citiq / Recharger / Conlog prepaid | Electricity/water | vendor | — | portal | — | — | Unsupported |
| Sonoff POW Elite | Electricity | snippets only | ≈R360–R430 [S] | eWeLink cloud | — | — | Unsupported (not billing-grade; no documented local API for this model) |

## Installation requirements (summary)

- Water: registered plumber for any meter; pulse counters are non-invasive; never alter a municipal meter.
- Electricity: registered electrician + Certificate of Compliance for any DB alteration; three-phase needs the right
  registration.
- Tenant recharge: SABS-approved submeter wording in by-laws (Cape Town s20; Ekurhuleni) and NERSA resale guidelines
  (§8.3 tariff identical, §8.5 no meter-reading/billing cost recovery). MID ≠ SA type approval.

## Not verified (carried forward)

Pulse-head compatibility of SA pulse-ready meters; VAT basis of several listings; SW3L-LB LoRaWAN decoder; ChirpStack
`object` presence when no codec is set; TTS request-authentication header name; ThingsBoard `GET /api/auth/user` as a
verification endpoint (Likely; standard but not re-read this session); Kamstrup LoRaWAN variant availability in SA.
