# 前端測試清理 — Phase 1 完成基線

- 拍照時間：2026-04-29T00:11:25+08:00
- Git HEAD：800f6c60
- Phase 1 完成項目：coverage baseline 記錄（測試套件未異動）

## 覆蓋率（v8 provider）

| 指標        | 百分比   |
|------------|---------|
| Statements | 90.04%  |
| Branches   | 82.18%  |
| Functions  | 90.42%  |
| Lines      | 91.14%  |

## 測試統計

- 測試檔總數：144
- 測試案例總數：2775

## Vitest Summary 原文

```
 Test Files  144 passed (144)
      Tests  2775 passed (2775)
   Start at  00:11:12
   Duration  13.59s (transform 6.22s, setup 12.64s, import 13.68s, tests 9.70s, environment 50.31s)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   90.04 |    82.18 |   90.42 |   91.14 |
 composables       |   99.66 |    92.77 |     100 |   99.65 |
 composables/canvas|   86.02 |    75.31 |   85.51 |   88.03 |
 composables/chat  |   93.69 |    83.50 |   93.87 |   96.24 |
 composables/eventHandlers | 91.16 | 84.46 | 83.33 | 90.86 |
 composables/pod   |   89.34 |    77.16 |    92.3 |   91.11 |
 services          |   10.61 |    11.66 |      15 |   10.81 |
 services/websocket|   89.44 |    76.11 |   91.42 |   89.87 |
 stores            |   95.19 |    89.28 |   92.67 |   96.13 |
 stores/chat       |   95.25 |    85.15 |   97.93 |   97.18 |
 stores/note       |   91.35 |    90.22 |   86.84 |   90.86 |
 stores/pod        |   92.19 |    91.91 |    95.6 |   92.62 |
 stores/run        |   96.89 |    88.37 |     100 |   97.84 |
 stores/upload     |   70.27 |    53.84 |    82.6 |   74.57 |
 utils             |   97.77 |    89.47 |     100 |   99.51 |
-------------------|---------|----------|---------|---------|-------------------
```

## 備註

- coverage provider：`@vitest/coverage-v8 ^4.0.18`（已在 devDependencies）
- `services` 目錄覆蓋率偏低（10.61% stmts），因為 API 模組（backupApi、configApi、podApi 等）未被測試直接涵蓋
- `stores/upload` 覆蓋率也偏低（70.27% stmts / 53.84% branches）
- `safeJsonParse.ts` 與 `throttle.ts` 目前覆蓋率為 0%
