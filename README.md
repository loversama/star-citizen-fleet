# Star Citizen Fleet Command

A browser-based fleet manager for Star Citizen. Browse every ship, build your fleet, assign crew, and view 3D holographic models.

![Built with](https://img.shields.io/badge/Built%20with-HTML%20%2B%20JS-blue) ![Ships](https://img.shields.io/badge/Ships-241%2B-cyan) ![3D Models](https://img.shields.io/badge/3D%20Models-GLTF%20Holo%20Viewer-purple)

## Features

- **Ship Database** - All 241+ ships from the FleetYards API with images, specs, and filters (manufacturer, size, type, flight-ready status)
- **Fleet Builder** - Add multiple copies of any ship to your personal fleet
- **Crew Management** - Create crew members and assign them to ships
- **3D Holo Viewer** - Interactive holographic ship models (Three.js + Draco-compressed GLTF) with auto-rotate, drag, and zoom
- **Fleet View** - Top-down grid with draggable ship cards showing 3D holo renders and crew assignments
- **Screenshot** - Capture your fleet layout as a PNG
- **Persistence** - Fleet, crew, and positions saved to localStorage

## Usage

Just two files - open `index.html` in a browser. No build step, no dependencies to install.

```
index.html  - UI and styles
app.js      - All application logic
```

Or serve with any static HTTP server:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# Docker
docker run -d -p 8080:80 -v $(pwd):/usr/share/nginx/html:ro nginx:alpine
```

## Data Source

Ship data, images, and 3D GLTF models provided by the [FleetYards.net API](https://api.fleetyards.net) (no API key required).

## Tech

- Vanilla JS (no framework)
- [Three.js](https://threejs.org/) r128 + GLTFLoader + DRACOLoader + OrbitControls
- [html2canvas](https://html2canvas.hertzen.com/) for screenshots
- All dependencies loaded from CDN

## License

MIT
