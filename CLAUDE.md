# CLAUDE.md — 项目记忆

## 项目
2D 网页联机射击小游戏：房间码进房（2–4 人），PvP + 怪物 + 持枪 Boss，WASD 移动 + 方向键射击（两键同按斜射），几何画风零素材。权威服务器架构：Node.js + ws，客户端纯 Canvas 渲染。朋友休闲局。

## 文件与职责
- `shared.js` — **所有游戏数值的唯一来源**（武器表/玩家/怪物/Boss/地图墙/刷新点），UMD 双端共享；调手感只改这个文件。含纯逻辑函数（fireDir/weaponFire/bulletStep/moveWithWalls 等）
- `server.js` — HTTP 静态托管 + WebSocket + 房间管理 + 30 tick/s 权威模拟（移动/射击/碰撞/刷怪/Boss AI/广播全量 state 带实体 id）
- `public/client.js` — 按键采集（变化才发）、按 id 匹配前后帧插值（60fps 平滑）、状态 diff 推测事件放粒子、HUD（状态栏/计分板/雷达小地图）
- `public/index.html` — 大厅 + canvas 页
- `test.js` — 纯 assert 测试，`node test.js` 直接跑，无框架
- `docs/superpowers/specs/2026-09-08-2d-shooter-design.md` — 设计规格（与代码同步维护）
- `.superpowers/sdd/2026-09-08-2d-shooter/progress.md` — SDD 进度台账（git-ignored，含全部计划外改动记录）

## 铁律
- 数值一律进 shared.js，不许在 server/client 散落魔法数
- **不做防挂加固**（用户明确：随便玩玩）；但崩溃防护类守卫要做
- 零美术素材、零新依赖（唯一依赖 ws）
- 客户端不模拟游戏规则，只渲染 + 纯视觉特效（粒子/插值/震动）
- 改完必同步：test.js 断言 + spec 文档 + 台账

## 运行与验证
- 启动：`node server.js`（端口 3000）；局域网可玩已验证（监听 0.0.0.0，防火墙 node.exe 公用配置已放行，WLAN IP 见 ipconfig）
- 验证流程：`node --check server.js shared.js public/client.js && node test.js` → 提交 → 重启 3000 服务器 → curl 200
- **Windows/bash 陷阱**：Bash 工具是 bash —— 临时服务器用 `PORT=3100 node server.js`（不是 cmd 的 set）；杀进程 `taskkill //PID X //F`（双斜杠）；查端口 `netstat -ano | findstr :3000 | findstr LISTENING`。改完代码必须重启服务器才生效；杀自己的后台任务会收到 failed 通知，属预期

## 用户协作模式
- 中文交流；试玩 → 提小改 → 我先在聊天里给简短设计（bounded path）→ 用户说"可以/开工"才动手
- 用户会中途插入修订数值（如"直接命中吃80伤害"），按最新口径执行

## 当前状态（2026-09-13）
- **已上线**：feat/game 已合并进 `main` 并推送 GitHub（kexing1314/2D-shoot-game），部署在阿里云 Ubuntu 服务器（`/opt/game` + pm2 进程名 `game` + 安全组放行 TCP 3000），公网 `http://IP:3000` 可玩；以后直接在 main 上开发
- 更新流程：本地 commit + `git push` → 服务器 `cd /opt/game && git pull && pm2 restart game`（纯 client.js 改动免 restart，玩家刷新即可）
- 核心游戏 + 全部试玩迭代完成（状态栏/武器射程/斜射/持枪Boss+攻击节奏/受伤硬直击退/视觉升级包/低血肾上腺素/加农炮爆炸弹+冲击波圈/数值调优/换弹系统+头顶提示/30Hz tick）；本地开服用 start.bat（纯 ASCII，cmd GBK 陷阱）
- tick 频率 30Hz（TICK_MS=33，云端降延迟调优）；用户 ping ~49ms，体感延迟 ~65ms 属物理底线
