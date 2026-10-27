# Director A/B: Claude vs Gemini

10 briefs × 4 models. Plans are scored by automatic checks and by blind judges from both model families (Claude Opus 5.5 and Gemini 4 Argon, positions shuffled, labels hidden).

## Automatic checks

| Model | Plans ok | Clean after repair | Sales ending on a taught film | Screenshots used | Voiceover vs budget | Avg time | Avg tokens out |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | 10/10 | 10/10 | 0/6 | 9/9 | 97.2% | 63.3s | 6932 |
| claude-sonnet-5-5 | 10/10 | 10/10 | 0/6 | 9/9 | 94.8% | 68.4s | 10053 |
| gemini-3.1-pro | 10/10 | 9/10 | 0/6 | 9/9 | 73.0% | 92.2s | 8210 |
| gemini-3.8-flash | 10/10 | 10/10 | 0/6 | 9/9 | 74.3% | 56.3s | 7301 |

## Blind judge scores (1-10, average over briefs and both judges)

| Model | Type fit | Structure | Script | Context use | Screenshots | Faithfulness | Overall | Avg rank (1 = best) |
|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | 9.0 | 8.5 | 8.4 | 7.5 | 6.4 | 8.6 | **8.0** | 1.5 |
| claude-sonnet-5-5 | 8.8 | 8.2 | 8.1 | 7.3 | 6.8 | 8.4 | **7.9** | 1.6 |
| gemini-3.1-pro | 7.5 | 7.0 | 6.4 | 6.5 | 6.0 | 7.5 | **6.8** | 3.2 |
| gemini-3.8-flash | 6.7 | 6.3 | 5.5 | 6.3 | 5.6 | 6.6 | **6.2** | 3.7 |

## By kind of film (overall score, average of both judges)

| Kind | claude-opus-5-5 | claude-sonnet-5-5 | gemini-3.1-pro | gemini-3.8-flash |
|---|---|---|---|---|
| explainer | 8.0 | 8.3 | 7.2 | 6.6 |
| tutorial | 8.3 | 7.6 | 7.3 | 6.1 |
| demo | 8.1 | 7.9 | 5.9 | 5.9 |
| promo | 8.4 | 7.9 | 6.3 | 6.9 |
| story | 7.3 | 7.3 | 6.8 | 5.3 |
| data | 8.2 | 7.8 | 6.6 | 4.1 |

## Judge agreement

- claude-opus-5-5: claude-opus-5-5 7.7, claude-sonnet-5-5 7.4, gemini-3.1-pro 6.3, gemini-3.8-flash 5.6
- gemini-4-argon: claude-opus-5-5 8.4, claude-sonnet-5-5 8.4, gemini-3.1-pro 7.3, gemini-3.8-flash 6.7

## Video-type inference (words + template only, no model)

- e1-binary-search: expected explainer, inferred explainer ✓
- e2-merge-sort: expected explainer, inferred explainer ✓
- e3-api-flow: expected explainer, inferred explainer ✓
- e4-sky-sketch: expected explainer, inferred explainer ✓
- t1-invite: expected tutorial, inferred tutorial ✓
- d1-demo: expected demo, inferred demo ✓
- p1-ad: expected promo, inferred promo ✓
- p2-launch: expected promo, inferred promo ✓
- s1-story: expected story, inferred story ✓
- x1-data: expected data, inferred data ✓
