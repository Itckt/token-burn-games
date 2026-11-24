(function (root) {
  "use strict";

  // Approximate J2000 mean elements: a (AU), e, i, mean longitude,
  // longitude of perihelion, longitude of the ascending node (angles in degrees).
  // radius and track are illustrative scene units, separate from physical data.
  const planets = [
    {
      id: "mercury", name: "Mercury", family: "Terrestrial planet", tint: "#b6aea3",
      diameter: 4879, spinDays: 58.646, tilt: 0.03, radius: 0.35, track: 4.35,
      elements: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
      description: "A cratered world that races around the Sun in just 88 Earth days."
    },
    {
      id: "venus", name: "Venus", family: "Terrestrial planet", tint: "#e6bf82",
      diameter: 12104, spinDays: -243.025, tilt: 2.64, radius: 0.55, track: 6.9,
      elements: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
      description: "A thick veil of clouds wraps this slow-spinning, intensely hot world."
    },
    {
      id: "earth", name: "Earth", family: "Terrestrial planet", tint: "#78a7be",
      diameter: 12742, spinDays: 0.99727, tilt: -23.44, radius: 0.68, track: 9.6,
      elements: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
      description: "Liquid oceans, shifting clouds and a thin atmosphere shape our home world."
    },
    {
      id: "mars", name: "Mars", family: "Terrestrial planet", tint: "#ce825f",
      diameter: 6779, spinDays: 1.02596, tilt: 25.19, radius: 0.46, track: 12.6,
      elements: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      description: "Iron-rich dust gives this rocky world its signature rust-red surface."
    },
    {
      id: "jupiter", name: "Jupiter", family: "Gas giant", tint: "#d2ac8d",
      diameter: 139820, spinDays: 0.41354, tilt: 3.13, radius: 1.48, track: 16.8,
      elements: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
      description: "Swift jets draw bands across the largest planet in the solar system."
    },
    {
      id: "saturn", name: "Saturn", family: "Gas giant", tint: "#ddc79d",
      diameter: 116460, spinDays: 0.444, tilt: 26.73, radius: 1.12, track: 20.45,
      elements: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
      description: "Countless pieces of ice trace bright, broad rings around this gas giant."
    },
    {
      id: "uranus", name: "Uranus", family: "Ice giant", tint: "#91c6c7",
      diameter: 50724, spinDays: 0.71833, tilt: 97.77, radius: 0.84, track: 23.9,
      elements: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
      description: "Pale methane clouds circle an ice giant that spins almost on its side."
    },
    {
      id: "neptune", name: "Neptune", family: "Ice giant", tint: "#6e91c3",
      diameter: 49244, spinDays: 0.67125, tilt: 28.32, radius: 0.81, track: 27.1,
      elements: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
      description: "Fast winds sweep blue cloud bands around the most distant planet."
    }
  ];
  const sun = {
    id: "sun", name: "Sun", family: "G-type star", tint: "#ffbc62", radius: 1.82,
    diameter: 1392700, spinDays: 25.05, tilt: 7.25,
    description: "Our star holds the planets in orbit and supplies their light and warmth."
  };
  const earth = planets.find(body => body.id === "earth");
  const lunarDiameter = 3474.8;
  const moon = Object.freeze({
    id: "moon", name: "Moon", family: "Natural satellite", tint: "#c9cbd0",
    diameter: lunarDiameter, radius: earth.radius * lunarDiameter / earth.diameter, tilt: 1.54, spinDays: 27.32166
  });
  planets.forEach((planet, index) => {
    planet.order = index + 1;
    Object.freeze(planet.elements);
    Object.freeze(planet);
  });
  Object.freeze(planets);
  Object.freeze(sun);
  const bodies = Object.freeze([sun, ...planets]);
  const byId = Object.freeze(Object.fromEntries([...bodies, moon].map(body => [body.id, body])));
  const api = { planets, sun, moon, bodies, byId };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.OrbitAtlas ||= {}).catalog = api;
})(globalThis);
