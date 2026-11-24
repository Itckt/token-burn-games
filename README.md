# token-burn-games

這 27 個小遊戲，全部由 16 個 Codex CLI worker 自動寫成（gpt-6.2-astra，最高 effort），一邊做一邊燒光一個禮拜的 token 額度。
27 small games written entirely by 16 automated Codex CLI workers while burning through a week of token quota.

## 點玩 / How to play

Windows：雙擊 `play.bat`，揀號碼，然後撳 Enter。

- **1–16 網頁 / 3D**：用瀏覽器開。你亦都可以直接開 `games/<號碼>/index.html`。
- **17–27 終端機**：會開一個新視窗。要裝 Python 3 同 Node.js。

| # | 資料夾 | 遊戲 | 類型 |
|---|---|---|---|
| 1 | `001` | 3D 校園漫遊（九龍塘風） | web |
| 2 | `002` | 3D 3v3 亂鬥 | web |
| 3 | `003` | 3D 卡牌對戰（兩條路、塔） | web |
| 4 | `004` | 3D 香港霓虹夜景 | web |
| 5 | `005` | 3D 杯麵剖面動畫 | web |
| 6 | `006` | 3D 港鐵式車程 | web |
| 7 | `007` | 3D 扭計骰 | web |
| 8 | `008` | 3D 地形生成器 | web |
| 9 | `009` | 3D 波子軌道 | web |
| 10 | `010` | 3D 茶餐廳模型 | web |
| 11 | `011` | 3D 颱風視覺化 | web |
| 12 | `012` | 3D 太陽系 | web |
| 13 | `067` | 每日打卡（登入獎勵日曆風） | web |
| 14 | `080` | 廣東話俗語字典 + 小測 | web |
| 15 | `088` | 細胞自動機（規則 0-255） | web |
| 16 | `089` | 彈波物理 | web |
| 17 | `018` | 文字冒險：香港大學生 | `python game.py` |
| 18 | `034` | 即時卡牌對戰（終端機） | `python -m gutterlight play --seed 27` |
| 19 | `035` | 3v3 自動對戰模擬 | `python -m pinchline --seed 852` |
| 20 | `040` | 跌落方塊 | `node game.js` |
| 21 | `041` | 貪食蛇 | `node snake.js` |
| 22 | `042` | 2048 | `python -m game2048` |
| 23 | `043` | 四子棋 vs AI | `python play.py connect-four` |
| 24 | `058` | 杯麵工廠大亨 | `python noodle.py` |
| 25 | `079` | Freelance 接 job 模擬 | `python play.py` |
| 26 | `085` | 21 點 | `python -m blackjack --rounds 20 --seed 852` |
| 27 | `111` | 塔防 | `python weirlight.py` |

如果唔用選單，就喺遊戲資料夾裡面執行上面嗰行指令。每個資料夾都有自己嘅 `README.md`。

All code is AI-generated and hasn't been fully reviewed by a human, so expect rough edges.
