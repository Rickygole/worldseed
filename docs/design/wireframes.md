# Wireframes (low fidelity)

ASCII at 1440 x 900 unless noted. `[ ]` = button, `···` = map, `(?)` = opens "How do we know?" or a chip popover.
All figures are placeholders: the app fills them from the simulator (copy: `docs/STORY.md`, `lib/ui/storyCopy.ts`).
Rule of the story path: one picture, one number, one sentence, one button; detail behind "How do we know?".

## Intro (first screen)

Only the map, the name, the dedication line, one sentence, one button and the slim notice. Escape skips.

```
+------------------------------------------------------------------------------------------------+
| WorldSeed                                                                                        |
|························································································|
|   In memory of the six construction workers who died when       ·····························|
|   the Key Bridge fell, March 26, 2024.            (small, gray)   ···· slow orbit ·············|
|                                                                  ·····························|
|   See who is affected if the                     (display 44)    ·····························|
|   bridge is removed.                                              ·····························|
|                                                                  ·····························|
|   [ Start the walk-through -> ]                                   ·····························|
|                                                                                                |
| Planning simulation, not dispatch.  About and sources                  (c) OSM, OpenMapTiles   |
+------------------------------------------------------------------------------------------------+
```

## Story shell (scenes 1 to 6)

```
+------------------------------------------------------------------------------------------------+
| WorldSeed               <  1  (2 The local story)  3  4  5  6  >               [Expert mode]  |
|························································································|
|································  3D map, full bleed  ········································|
|  +--------------------------------------+ ······························································|
|  | SCENE 2 OF 6                         | ··························   popovers open here,  ·····|
|  | Averages hide the local story        | ··························   beside the card     ·····|
|  | about                      SIMULATED | ······························································|
|  | 20,000  people          (display 88) | ······························································|
|  | Reach over 10% fewer jobs across ... | ······························································|
|  | ( About 6,700 to 96,000, depending ?)| ······························································|
|  |                                      | ······························································|
|  | Most of the worst-hit spots are near | ······························································|
|  | Sparrows Point and Edgemere. (26 px) | ······························································|
|  |                                      | ······························································|
|  | [ Show me where ]   How do we know?  | ······························································|
|  +--------------------------------------+ ······························································|
| Planning simulation, not dispatch.  About and sources                  (c) OSM, OpenMapTiles   |
+------------------------------------------------------------------------------------------------+
```

Per scene (number, sentence, button; the button becomes "Next: <step>" once its map action is done):

| Scene | Number | Sentence | Button |
|---|---|---|---|
| 1 The bridge | 0 -> about 3 seconds (rolls) | "Remove the Key Bridge from the map..." -> "On average, a drive to jobs in the region gets only about 3 seconds longer." | Remove the Key Bridge |
| 2 The local story | about 20,000 people + range chip | "Most of the worst-hit spots are near Sparrows Point and Edgemere." | Show me where (switches to the cross-harbor view, flies to the peninsula) |
| 3 What held | 6.1 minutes + "Unchanged from before" | "Both sides of the river have fire stations, so the time to the nearest one did not change." | Show both sides |
| 4 Dangerous cargo | about 15 minutes; caption "cars add about 6 minutes" | "Both tunnels bar listed hazardous loads, so in the model those trucks take much longer." + escort note | Show the detour |
| 5 What could help | what-if ideas -> runs done -> about 23% + "Still affected: about 15,000 people" | ready / searching / "The best idea we tried helps, but it does not undo the loss." + planner line | Find a better future -> Stop search -> Apply the best idea -> Continue |
| 6 Explore | about 15,000 people (live) | "Now it is your turn: click the map, switch views, and check the assumptions." | Open expert mode |

## Expert mode (1440 x 900)

```
+------------------------------------------------------------------------------------------------+
| WorldSeed (Scenario: Key Bridge link removed)  (Deterministic search (no AI)) [Assumptions] [K]  <- Back to the story |
+-------------+------------------------------------------------------------+---------------------+
| SCENARIO    |                                                            | PLANNER             |
| [Restore]   |                                                            | Goal Search Finals. Apply (one step open)
| Roads as of |                     3D map                                 | Goal sentence       |
| MAP LENS    |                                                            | > Adjust the goal   |
| o Cross-hbr |                                                            | [Find a better future]
| o Regional  |                                                            |                     |
| o Stations  |                                                            |                     |
| legend      |                                                            |                     |
| TOOLS       |                                                            |                     |
| Hazmat >    |         ( Preview: nothing 46% | #1 79% | #2 63% | #3 58% )|                     |
| > What this shows                                                        | > Decision log      |
| > Event log |                                                            |                     |
+-------------+------------------------------------------------------------+---------------------+
| People affected | Regional drive | Station time | Trip across the river | Dangerous cargo       |
+------------------------------------------------------------------------------------------------+
| Planning simulation, not dispatch. AI-generated text may be inaccurate. About | Data credits  |
+------------------------------------------------------------------------------------------------+
```

## Story at 390 x 844 (bottom sheet)

```
+------------------------------+
| WorldSeed      [Expert mode] |
|······························|
|··········· map ··············|
|······ (c) OSM attribution ···|
+------------------------------+
| <  o o * o o o  >  2 / 6   v |
| SCENE 2 OF 6                 |
| Averages hide the local story|
| about              SIMULATED |
| 20,000 people                |
| Reach over 10% fewer jobs... |
| (About 6,700 to 96,000 ... ?)|
| Most of the worst-hit spots  |
| are near Sparrows Point...   |
| [ Show me where ]            |
| How do we know?              |
| Planning simulation, not ... |
+------------------------------+
```
