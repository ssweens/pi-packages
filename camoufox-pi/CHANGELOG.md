# Changelog

## [0.2.2] (2026-06-02)

### Bug Fixes

* **postinstall:** patch playwright-core `FFBrowserContext` and `FFPage._onUncaughtError` to guard against undefined `location` on page errors fired after context teardown on React/Next.js SPAs. Prevents uncaughtException crash that killed the pi host process. Patch is idempotent and version-tolerant. ([scripts/patch-playwright-core.mjs](./scripts/patch-playwright-core.mjs))

---

## [0.2.1](https://github.com/MonsieurBarti/camoufox-pi/compare/camoufox-pi-v0.2.0...camoufox-pi-v0.2.1) (2026-04-13)


### Features

* **client:** delegate search to orchestrator with engine option ([5d8bac6](https://github.com/MonsieurBarti/camoufox-pi/commit/5d8bac6acc7405e527f9856c4559a09c9522c9ce))
* **errors:** add search_all_engines_blocked variant ([baaf6a2](https://github.com/MonsieurBarti/camoufox-pi/commit/baaf6a2e28433a03a797e6039028336222af9847))
* google adapter with auto-mode fallback (milestone 4) ([821a163](https://github.com/MonsieurBarti/camoufox-pi/commit/821a1639ada485b70fabf1fbc3a21df9a4a88c8c))
* **search:** add dedicated searchcontext with recycle policy ([ef91369](https://github.com/MonsieurBarti/camoufox-pi/commit/ef91369a7fecb298eaadead2297f514ea39172c8))
* **search:** add google adapter block-detection ([2874eaa](https://github.com/MonsieurBarti/camoufox-pi/commit/2874eaa6c900a5d56d007b66392d437293ac81db))
* **search:** add google adapter consent-dismissal ([4d11760](https://github.com/MonsieurBarti/camoufox-pi/commit/4d117609c861f0086204ccf7768a7586dfa85f19))
* **search:** add google adapter parser ([014a4a5](https://github.com/MonsieurBarti/camoufox-pi/commit/014a4a586fb4d7f16ba322aafc38c1c3226ef648))
* **search:** add runsearch orchestrator with auto-mode fallback ([be316d3](https://github.com/MonsieurBarti/camoufox-pi/commit/be316d32b84cdf2200fe91e40295615c84c25323))
* **search:** widen adapter types for multi-engine support ([5d5487f](https://github.com/MonsieurBarti/camoufox-pi/commit/5d5487fb2c71800d2966d2706e9cf77e813820bd))
* **tool:** surface engine option and refresh search-web description for auto-mode ([fea5705](https://github.com/MonsieurBarti/camoufox-pi/commit/fea5705d2c58e5c61b37326d2da6da8c30915408))
* **types:** export searchenginename and searchenginechoice ([9b447ed](https://github.com/MonsieurBarti/camoufox-pi/commit/9b447edc1118718eaeff20af6ddad44de8cc1e52))


### Bug Fixes

* **search:** guard searchcontext init against concurrent acquirepage races ([938e34e](https://github.com/MonsieurBarti/camoufox-pi/commit/938e34e6c6d021a9749f6e0a4fd2c534029fd325))
* **search:** remove dead isolate option from client.search and search-web tool ([0272d9f](https://github.com/MonsieurBarti/camoufox-pi/commit/0272d9fdc98fa801957f250b44f8150f12e9c140))
* **search:** restore unconditional pre-flight ssrf assertion in runsearch ([b619511](https://github.com/MonsieurBarti/camoufox-pi/commit/b619511ab3706671e43ea1091e6ae95dc59a733a))
* **search:** sanitize nav-error cause and cover mid-loop abort ([b9e46e5](https://github.com/MonsieurBarti/camoufox-pi/commit/b9e46e5ff54a4e74d768e43601a73eb6fa3c0d7f))
* **security:** sanitize paths and env-var references in error messages (sec2) ([a01b575](https://github.com/MonsieurBarti/camoufox-pi/commit/a01b5757c6eb27320e3faca59f6fb89bca846b99))
* **security:** widen path and env-var redaction in sanitizeformessage ([c94e3eb](https://github.com/MonsieurBarti/camoufox-pi/commit/c94e3eb4c4a5ddd18fd11839d035051cfa45f812))

## [0.2.0](https://github.com/MonsieurBarti/camoufox-pi/compare/camoufox-pi-v0.1.3...camoufox-pi-v0.2.0) (2026-04-13)


### ⚠ BREAKING CHANGES

* **client:** migrate initial-url ssrf error to ssrf_blocked { hop: initial }

### Features

* **client:** attach ssrf guard in navigate and surface ssrf_blocked on goto reject ([8b8a052](https://github.com/MonsieurBarti/camoufox-pi/commit/8b8a05286c22b6aca4182a0a024c453d9735251d))
* **client:** migrate initial-url ssrf error to ssrf_blocked { hop: initial } ([5bd28a2](https://github.com/MonsieurBarti/camoufox-pi/commit/5bd28a2c688406bc2932b72c9e2e2ab02a5afd4d))
* **client:** re-check ssrf guard after post-nav pipeline in fetchurl and search ([d41f955](https://github.com/MonsieurBarti/camoufox-pi/commit/d41f95590e40c969e4f176fbecc34ebad833def2))
* **errors:** add ssrf_blocked variant to camoufoxerror ([62c6f7f](https://github.com/MonsieurBarti/camoufox-pi/commit/62c6f7f75af31181ced22605106d4872f61669e6))
* **security:** add attachssrfguard for per-hop redirect ssrf protection ([71334fb](https://github.com/MonsieurBarti/camoufox-pi/commit/71334fb97a2acc723617bc3de4861d45ddd7e0fc))


### Bug Fixes

* **client:** prioritize ssrf_blocked over pipeline errors in fetchurl and search catch ([8ae7be7](https://github.com/MonsieurBarti/camoufox-pi/commit/8ae7be7199c8830edc7cef2111b57e7ffd615abf))
* **security:** harden ssrf, tier sub-resource blocking, cover popups ([c9973e0](https://github.com/MonsieurBarti/camoufox-pi/commit/c9973e0fea991e74985286632739292cf132c0b2))

## [0.1.3](https://github.com/MonsieurBarti/camoufox-pi/compare/camoufox-pi-v0.1.2...camoufox-pi-v0.1.3) (2026-04-13)


### Features

* **client:** add capture-page-screenshot helper ([8ce61d3](https://github.com/MonsieurBarti/camoufox-pi/commit/8ce61d37f0b5061f11b1548f1bfe9181878d2874))
* **client:** add extract-slice helper for selector-scoped extraction ([3600764](https://github.com/MonsieurBarti/camoufox-pi/commit/3600764f8fca0262c1f181d5e1cc497ab6b34296))
* **client:** add html-to-markdown with relative-url absolutization ([19562df](https://github.com/MonsieurBarti/camoufox-pi/commit/19562df70dda2dfb9bbd54e793c59b6df240da91))
* **client:** add markdown format to fetch-url ([3d6e6a2](https://github.com/MonsieurBarti/camoufox-pi/commit/3d6e6a2f7edaff98bcea338774cdeb24069b0f23))
* **client:** add resolve-wait-until helper for render mode ([79dcc3d](https://github.com/MonsieurBarti/camoufox-pi/commit/79dcc3d002e7c5547db159a636012fa173d2eba4))
* **client:** add screenshot capture to fetch-url ([799fabe](https://github.com/MonsieurBarti/camoufox-pi/commit/799fabe1a01bba30424cdbfb58d759a13af5a1a4))
* **client:** add selector scoping to fetch-url ([614374f](https://github.com/MonsieurBarti/camoufox-pi/commit/614374fa4f08166c5292b6bc5b84eb71081feeb1))
* **client:** add wait-for-selector to fetch-url pipeline ([deace9d](https://github.com/MonsieurBarti/camoufox-pi/commit/deace9db7462600acaca8ca31e92b26f277ce17a))
* **client:** add wait-for-selector-or-throw helper ([c52c9d0](https://github.com/MonsieurBarti/camoufox-pi/commit/c52c9d004e08072a59779c2e39b173c3737d639c))
* **client:** extend fetch-url event payload with feature flags ([49e0e86](https://github.com/MonsieurBarti/camoufox-pi/commit/49e0e862f753dc309146aec6cf9f2e39d8438dfc))
* **client:** fetch-url capability parity (milestone 3) ([9ddb354](https://github.com/MonsieurBarti/camoufox-pi/commit/9ddb35405c85e65bfcadbc1a20c83281699d2120))
* **client:** wire render-mode through fetch-url to wait-until ([71d4b3b](https://github.com/MonsieurBarti/camoufox-pi/commit/71d4b3b511d68932bf61edce5784c1cbe42f88d5))
* **errors:** add wait_for_selector and screenshot timeout phases ([f7672df](https://github.com/MonsieurBarti/camoufox-pi/commit/f7672dfb83bf0dbb6df156475c28aac57d71629a))
* **tool:** extend tff-fetch-url with render/selector/markdown/screenshot ([d94f786](https://github.com/MonsieurBarti/camoufox-pi/commit/d94f7865ec7f94d1295ad3f398af28160c3a72a7))


### Bug Fixes

* **client:** surface turndown failures via outer config_invalid wrapper ([54d5f30](https://github.com/MonsieurBarti/camoufox-pi/commit/54d5f30b6b6b4bde6569bee312fc20e35ebdfe79))
* **client:** wrap raw playwright errors from post-nav pipeline ([e338236](https://github.com/MonsieurBarti/camoufox-pi/commit/e338236bce49ef006dd85bfe78192bef29fb1ce3))

## [0.1.2](https://github.com/MonsieurBarti/camoufox-pi/compare/camoufox-pi-v0.1.1...camoufox-pi-v0.1.2) (2026-04-12)


### Features

* **client:** add checkhealth probe mode ([76ac81d](https://github.com/MonsieurBarti/camoufox-pi/commit/76ac81dccc7ec626fc293afe60a1a449d2304eaa))
* **client:** add checkhealth snapshot mode ([77d1aa0](https://github.com/MonsieurBarti/camoufox-pi/commit/77d1aa0286ffa4d83b6c1256d967f28c951de6dd))
* **client:** add createclient factory with lazy launch ([1d86e0e](https://github.com/MonsieurBarti/camoufox-pi/commit/1d86e0ebcb5d6c41f5c44885d46d03d53fed63d1))
* **client:** add typed event emitter and span-id helper ([458bec5](https://github.com/MonsieurBarti/camoufox-pi/commit/458bec5c286ac74f6a835cb3cfcd6131cfb66a2b))
* **client:** emit browser_launch and binary_download_progress events ([29d39b5](https://github.com/MonsieurBarti/camoufox-pi/commit/29d39b5dd78bf01dcb18d23e6bb0f26a395f98c6))
* **client:** emit fetch_url, search, and error events on op paths ([b050f2c](https://github.com/MonsieurBarti/camoufox-pi/commit/b050f2c94cda4f38c464e02df48f793fa29b4909))
* **client:** thread onprogress callback through launcher interface ([f6fd4cf](https://github.com/MonsieurBarti/camoufox-pi/commit/f6fd4cfba34f576fccbfd07ce2073760f03f3571))
* public CamoufoxClient, events bus, checkHealth (milestone 2) ([f758055](https://github.com/MonsieurBarti/camoufox-pi/commit/f758055a40484398a3cca3fb44ed8cd3a35fe07b))


### Bug Fixes

* **client:** isolate async event listener rejections ([e9d523a](https://github.com/MonsieurBarti/camoufox-pi/commit/e9d523a785e8ac5b427b31af5a69304e3bc739d1))
* **security:** ssrf-check search(), widen spanid, validate binary path ([5f92675](https://github.com/MonsieurBarti/camoufox-pi/commit/5f92675a7d9d42c88e063bf71db007382cfdb36d))

## [0.1.1](https://github.com/MonsieurBarti/camoufox-pi/compare/camoufox-pi-v0.1.0...camoufox-pi-v0.1.1) (2026-04-12)


### Features

* **client:** add camoufoxclient lifecycle (ensureready, isalive, close) ([d1f231d](https://github.com/MonsieurBarti/camoufox-pi/commit/d1f231d502dcc198f62b106df048917b157c8ed5))
* **client:** add combinesignals helper ([84f03e8](https://github.com/MonsieurBarti/camoufox-pi/commit/84f03e8ddba74860919e3881bcfaebee7a165940))
* **client:** add launcher interface and launchedbrowser type ([8c29eb7](https://github.com/MonsieurBarti/camoufox-pi/commit/8c29eb775edfe713216f1b37b106afe3c570bbed))
* **client:** add navigate + fetchurl with signal + typed errors ([c7eb699](https://github.com/MonsieurBarti/camoufox-pi/commit/c7eb6996c44a53ecf81c1f154aa8e3a9b048ba99))
* **client:** add reallauncher backed by camoufox-js + playwright-core ([fb66f53](https://github.com/MonsieurBarti/camoufox-pi/commit/fb66f53471c28ccd33465c2066036049fcf87ead))
* **client:** add search method dispatching to duckduckgo adapter ([683828b](https://github.com/MonsieurBarti/camoufox-pi/commit/683828bc756b37a1479afc4454c5c5d0a7cb585b))
* **config:** populate camoufoxconfig with timeoutms + defaultengine ([16b219f](https://github.com/MonsieurBarti/camoufox-pi/commit/16b219f975126b03026371af1192f55ddc3f344c))
* **errors:** add camoufoxerror union, camoufoxerrorbox, mapplaywrighterror ([44a292e](https://github.com/MonsieurBarti/camoufox-pi/commit/44a292e4d7fc0d411da8af4fa734124e055b68b4))
* **extension:** thread abortsignal through tools; throw on invalid input ([7608aee](https://github.com/MonsieurBarti/camoufox-pi/commit/7608aeedb9f35af3766bc598cfccf7288fe795b8))
* **extension:** wire reallauncher and register tools on session_start ([d6af0f9](https://github.com/MonsieurBarti/camoufox-pi/commit/d6af0f943f8bb7f4fd7077db8d4cb7848bbcc1ff))
* foundational slice (camoufox-pi v0.1.0) ([3c278dc](https://github.com/MonsieurBarti/camoufox-pi/commit/3c278dc087b19ce6dfdbd4ea153e4f1a3899dceb))
* **search:** add duckduckgo html adapter with fixture test ([b1c5529](https://github.com/MonsieurBarti/camoufox-pi/commit/b1c552959a21f161508e41ca82e96bed7faa97d5))
* **search:** add searchengineadapter interface and rawresult ([f1b0b8c](https://github.com/MonsieurBarti/camoufox-pi/commit/f1b0b8c9b337388c80203cb70515060a2ec07821))
* **security:** harden fetch_url/search_web surface ([5ba738a](https://github.com/MonsieurBarti/camoufox-pi/commit/5ba738a0a1302af5ae877c92224115fe5e52a1bc))
* **service:** own camoufoxclient and kick off ensureready on init ([9d37de6](https://github.com/MonsieurBarti/camoufox-pi/commit/9d37de64414425ba37cf1bd30bec319a3611b654))
* **tools:** add tff-fetch_url tool wrapper ([9b1a2d1](https://github.com/MonsieurBarti/camoufox-pi/commit/9b1a2d1281f5534872b66bb31b3cc823f5e4c93b))
* **tools:** add tff-search_web tool wrapper ([eeb8d98](https://github.com/MonsieurBarti/camoufox-pi/commit/eeb8d98480df48d196b2d99838804261b16afa7d))


### Bug Fixes

* **client:** close during launching tears down freshly-launched browser ([744a54b](https://github.com/MonsieurBarti/camoufox-pi/commit/744a54b9a96e060f9224c118e7c6b4588c2fdc5d))
* **test-helpers:** remove launchfails leak into goto and track per-page url ([15c56d5](https://github.com/MonsieurBarti/camoufox-pi/commit/15c56d513702b0b8098a94ef03e926a9bde808b9))
* **test:** ddg stub handles comma selector; adapter test asserts snippet content ([8776a51](https://github.com/MonsieurBarti/camoufox-pi/commit/8776a5126018c44f430414d83e99a0673189ea1b))
* **tools:** register uri format so url validation fires ([0aaa972](https://github.com/MonsieurBarti/camoufox-pi/commit/0aaa9727fae19c1c3f96be4c544b485d66e1b5a8))
* wrap post-goto errors; validate client input; rename truncated; note signal gap ([40e3105](https://github.com/MonsieurBarti/camoufox-pi/commit/40e310508e227dfb7875102ceb2810ec230c33d8))

## Changelog
