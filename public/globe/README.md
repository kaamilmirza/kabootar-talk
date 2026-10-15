# Globe assets

`elevation.png` is a 2048×1024 equirectangular greyscale elevation map: land height only, with the sea at zero. It is the `earth-topology.png` that ships with [three-globe](https://github.com/vasturiano/three-globe) (MIT), and it comes from NASA's public-domain topography.

It is served from this app on purpose. Loading map data from a tile server or CDN would tell a third party which part of the world someone is looking at, and on the flight screen that is the route of their letter.
