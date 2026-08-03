# Image sources and licenses

All 50 images in `corpus/images/` are free-to-use under their platform licenses.

| Set | Count | Source | License |
|---|---|---|---|
| `bear-1..10.jpg` | 10 | Unsplash / Pexels | Unsplash License / Pexels License |
| `deer-1..10.jpg` | 10 | Unsplash / Pexels | Unsplash License / Pexels License |
| `dog-1..10.jpg` | 10 | Unsplash / Pexels | Unsplash License / Pexels License |
| `fox-1..10.jpg` | 10 | Unsplash / Pexels | Unsplash License / Pexels License |
| `wolf-1..10.jpg` | 10 | Unsplash / Pexels | Unsplash License / Pexels License |

- Unsplash License: https://unsplash.com/license
- Pexels License: https://www.pexels.com/license/

Both permit free commercial and non-commercial use without attribution,
and prohibit redistribution as a standalone stock collection. Use here is as
a test corpus for an image-matching system, not redistribution.

## Note on labelling

Filename prefixes are my own labels, used as eval ground truth. Four are wrong:
`deer-6.jpg` through `deer-9.jpg` are impalas and Thomson's gazelles, not deer.
The vision model correctly identified them as African antelopes and returned
`species: unknown`. Kept deliberately — see README limitations.
