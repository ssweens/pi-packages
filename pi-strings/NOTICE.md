# Third-party notices

`vendor/pi-acp/src` is derived from [`svkozak/pi-acp`](https://github.com/svkozak/pi-acp) at commit `d1cffc047ab37a096ee70ca39cfc1de463db8d12` (version 0.0.33), Copyright © 2025 Sergii Kozak, under the MIT License in `vendor/pi-acp/LICENSE`.

The vendored adapter is intentionally maintained here because Pi worker launch policy, RPC deadlines, process ownership, state durability, and error semantics are part of pi-strings' safety boundary.

`acpx` is consumed as an exact-pinned dependency at version 0.13.0. Its public `acpx/runtime` export is wrapped by an internal port so it can be replaced without changing the Pi tool contract.
