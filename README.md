# E-Ink Dashboard

Portable 6" e-ink touch dashboard — Pi Zero 2W + Inkplate 6PLUS/6FLICK, UART, Obsidian integration.

**Status:** Planning / hardware not yet ordered

## Architecture
- **Brain:** Raspberry Pi Zero 2W (Linux, Python, Piper integration)
- **Display:** Inkplate 6PLUS/6FLICK (6" e-ink + capacitive touch, ESP32)
- **Comms:** UART between boards (3 wires, no WiFi overhead)
- **Power:** PiSugar 3 → Pi Zero, Pi 5V rail → Inkplate
- **Form factor:** Phone-slab, 3D printed enclosure

See project plan in issues.

