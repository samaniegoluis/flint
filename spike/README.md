# Spikes

Throwaway proofs. Nothing here is product code, nothing in `src/` imports it, and each can
be deleted once its feature lands.

## `multimon` and `rdp-monitors` (milestone 38)

Whether Flint can show one RDP desktop across two monitors (spec v10, milestone 38).

- `multimon`: a cfire `ext:webui` app plus a native shim (`native/spike_multimon.hpp`) that
  lists the monitors and opens a second native window with its own web view in the same
  process, on any monitor, as a plain window, borderless over the whole screen, or in the
  system's full screen; the two pages talk through the process.
  `./run.sh` (macOS, interactive); `SPIKE_AUTO=<monitor>,<main monitor> ./run.sh` runs every
  mode and logs frame rates and round trips; `./linux-docker.sh` does the same in
  linux-check's image under Xorg's dummy driver with two RandR outputs (Xvfb cannot).
- `rdp-monitors`: `probe.cpp`, FreeRDP 3 alone, connects to a Windows host with a monitor
  layout and reports what the server sends back, then changes the layout through Display
  Control. No input is sent.
  `clang++ -std=c++20 -o probe probe.cpp $(pkg-config --cflags --libs freerdp-client3 freerdp3 winpr3)`
  then `sec with FLINT_RDP_TEST_HOST FLINT_RDP_TEST_USER FLINT_RDP_TEST_PASSWORD -- ./probe "0,0,2560,1440,1,0,100;-1080,-235,1080,1920,0,0,100" gfx connect`.

The `pty-webui` spike of milestone 01 lives in git history (`81ea329`).
