# 遊戲選單：揀一個號碼，就會開嗰隻遊戲。
# 網頁遊戲用你嘅預設瀏覽器開；終端機遊戲會開一個新視窗。

$root = Join-Path $PSScriptRoot 'games'

$games = @(
    # 網頁 / 3D（用瀏覽器開）
    @{ n='001'; name='3D 校園漫遊（九龍塘風）';        web='index.html' }
    @{ n='002'; name='3D 3v3 亂鬥';                    web='index.html' }
    @{ n='003'; name='3D 卡牌對戰（兩條路、塔）';      web='index.html' }
    @{ n='004'; name='3D 香港霓虹夜景';                web='index.html' }
    @{ n='005'; name='3D 杯麵剖面動畫';                web='index.html' }
    @{ n='006'; name='3D 港鐵式車程';                  web='index.html' }
    @{ n='007'; name='3D 扭計骰';                      web='index.html' }
    @{ n='008'; name='3D 地形生成器';                  web='index.html' }
    @{ n='009'; name='3D 波子軌道';                    web='index.html' }
    @{ n='010'; name='3D 茶餐廳模型';                  web='index.html' }
    @{ n='011'; name='3D 颱風視覺化';                  web='index.html' }
    @{ n='012'; name='3D 太陽系';                      web='index.html' }
    @{ n='067'; name='每日打卡（登入獎勵日曆風）';     web='index.html' }
    @{ n='080'; name='廣東話俗語字典 + 小測';          web='index.html' }
    @{ n='088'; name='細胞自動機（規則 0-255）';       web='index.html' }
    @{ n='089'; name='彈波物理';                       web='index.html' }
    # 終端機遊戲（開新視窗）
    @{ n='018'; name='文字冒險：香港大學生';              cmd='python game.py' }
    @{ n='034'; name='即時卡牌對戰（終端機）';         cmd='python -m gutterlight play --seed 27' }
    @{ n='035'; name='3v3 自動對戰模擬';               cmd='python -m pinchline --seed 852' }
    @{ n='040'; name='跌落方塊';                       cmd='node game.js' }
    @{ n='041'; name='貪食蛇';                         cmd='node snake.js' }
    @{ n='042'; name='2048';                           cmd='python -m game2048' }
    @{ n='043'; name='四子棋 vs AI';                   cmd='python play.py connect-four' }
    @{ n='058'; name='杯麵工廠大亨';                   cmd='python noodle.py' }
    @{ n='079'; name='Freelance 接 job 模擬';          cmd='python play.py' }
    @{ n='085'; name='21 點';                          cmd='python -m blackjack --rounds 20 --seed 852' }
    @{ n='111'; name='塔防';                           cmd='python weirlight.py' }
)

while ($true) {
    Clear-Host
    Write-Host '==== 燒 token 燒出嚟嘅遊戲 ====' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '-- 網頁 / 3D --' -ForegroundColor Cyan
    for ($i = 0; $i -lt $games.Count; $i++) {
        if ($i -eq 16) { Write-Host ''; Write-Host '-- 終端機 --' -ForegroundColor Cyan }
        Write-Host ('{0,3}. {1}' -f ($i + 1), $games[$i].name)
    }
    Write-Host ''
    $pick = Read-Host '揀號碼（q 離開）'
    if ($pick -eq 'q') { break }
    $k = 0
    if (-not [int]::TryParse($pick, [ref]$k) -or $k -lt 1 -or $k -gt $games.Count) { continue }

    $g = $games[$k - 1]
    $dir = Join-Path $root $g.n
    if ($g.web) {
        Start-Process (Join-Path $dir $g.web)
    } else {
        $inner = "chcp 65001 > `$null; [Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
                 "`$env:PYTHONIOENCODING = 'utf-8'; `$Host.UI.RawUI.WindowTitle = '$($g.name)'; $($g.cmd)"
        Start-Process powershell.exe -WorkingDirectory $dir -ArgumentList '-NoExit', '-NoProfile', '-Command', $inner
    }
}
