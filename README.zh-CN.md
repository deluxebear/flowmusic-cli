# gfmusic — `flowmusic` 命令行工具

[English](README.md) | 简体中文

[Google Flow Music](https://www.flowmusic.app) 的非官方命令行客户端,通过逆向其网页客户端实现。
要求 Node ≥ 22,零依赖。

## 安装

```bash
npm install -g flowmusic-cli      # 全局安装,提供 `flowmusic` 命令
flowmusic --version

npx flowmusic-cli gen "lofi piano" --instrumental   # 或者不安装,直接用 npx 运行
```

从源码安装:`git clone https://github.com/deluxebear/flowmusic-cli && cd flowmusic-cli && npm link`。

## 使用

```bash
flowmusic login                                   # 首次登录(见「登录认证」)
flowmusic gen "dreamy synthwave, female vocals" --lyrics @lyrics.txt --title "Night Drive" --model "Lyria 3 Pro"
flowmusic gen "lofi piano" --instrumental --length 120 --wav
flowmusic batch prompts.txt --jobs 3               # 每行一个提示词(或 JSON 对象)
flowmusic extend|replace|cover|stems|trim|speed <clip> ...
flowmusic download <clip> --format mp3             # mp3 | wav | m4a(服务端转码)
flowmusic caption|transcribe <clip>                # 描述曲风 / 从音频识别歌词
flowmusic search clips "piano"  |  trending  |  featured
flowmusic playlists create|add|remove|rename|delete|show ...
flowmusic doctor                                   # 检查会话与接口结构是否正常
flowmusic help
```

运行 `npm test` 执行单元测试。

## 项目结构

```
bin/flowmusic.mjs      命令行入口
src/cli.mjs            参数解析、别名与命令分发
src/help.mjs           帮助文本
src/commands/          各类命令:create、edit、library、account,以及共享的 context
src/lib/               底层模块:client、auth、state、config、util、chrome_auth
test/                  单元测试(node --test)
skills/                给 AI 代理使用的技能
```

逆向研究用的脚本放在本地的 `research/` 目录,不纳入 Git 管理。

## 登录认证

```bash
flowmusic login                # 首次:在默认浏览器中走 OAuth(PKCE + 本地回环),无需 Chrome 自动化
flowmusic whoami | logout
flowmusic login --profile      # 备选:在专用的 Chrome profile 中登录(分两步,见下)
flowmusic login --from-chrome  # 借用正在运行的 Chrome 的 1 小时令牌(不会自动刷新)
```

- 会话(access token + refresh token)保存在 `~/.config/gfmusic/session.json`,文件权限为 600。
- access token 有效期 1 小时,过期前会静默刷新(遇到 HTTP 401 时也会再刷新一次),每次都会保存轮换后的
  refresh token。没有有效会话时,会自动弹出浏览器登录。
- `login` 会打开 `…supabase.co/auth/v1/authorize?provider=google&redirect_to=http://127.0.0.1:<port>/callback`,
  带上 PKCE challenge,在临时的本地回环服务器上接收授权码,再到 `/auth/v1/token?grant_type=pkce` 换取令牌。
- `--profile` 分两步,是因为 Google 会拦截带远程调试端口启动的浏览器登录:先用普通的 Chrome 窗口打开
  `~/.config/gfmusic/chrome-profile` 完成登录;关闭窗口后,再以无头模式重新打开该 profile,仅用来读取会话 cookie。
- CLI 始终使用**独立的** refresh token 链,不会使你日常浏览器里的登录会话失效。
- 环境变量:`FLOWMUSIC_TOKEN=<access_token>` 优先级最高,覆盖其他所有方式;`FLOWMUSIC_HOME` 修改存储目录;
  `CHROME_BIN` 指定浏览器。

## 逆向得到的工作流程

接口地址 `https://www.flowmusic.app/__api`,请求头 `Authorization: Bearer <supabase access_token>`。

### 两种生成方式
1. **Producer 对话(LLM 代理)**
   `POST /conversation/create` → `{conversation_id}`
   `POST /conversation {conversation_id, parts:[{content, part_kind:"user-prompt"}], client_context, model_name, mode:"standard"}` → `{job_id}`
   `GET /messages/{job_id}/stream?last_id=0`(SSE 事件:`begin, conversation_id, part, complete, generated-title, suggestion, final, error`)。
   代理会输出 `tool-call` / `tool-return` 片段,例如 `audio__create_song` → `{clip_id, operation_id}`。
2. **直接调用工具(不经过 LLM,网页创作表单用的就是这种,本 CLI 也使用这种)**
   `POST /producer/tool-call {conversation_id, part:{tool_name,args,part_kind:"tool-call",tool_call_id}, client_context}` → `{job_id}`
   之后读取同样的 SSE 流(事件类型为 `message`,内容在 `parts[]` 中),结果在 `tool-return` 片段里。

### 工具(`tool_name` → 参数 → 结果)

| 工具 | 参数 | 结果 |
|---|---|---|
| `audio__create_song` | `sound_prompt, lyrics_id, title, seed, image_id` | `clip_id, operation_id, estimated_time` |
| `lyrics__create` | `prompt` | `title, lyrics` |
| `audio__render_edit` | `recipe_id, title, image_id` | `clip_outputs[{clip_id}]` |
| `audio__split_stems` | `clip_id` | `stems[{stem_type, clip_id}]` |
| `audio__apply_effect` | `graph:[Input, Trim{start_s,end_s} \| TempoShift{speed,semitones}, Output], output_title` | `result_clip_id` |
| `image__create_image` | `prompt, aspect_ratio, image_urls` | `image_url` |
| `video__create_video_clip` | `inputs:{prompt, aspect_ratio, duration, model_name:"veo3-1-fast"}` | `url`(mp4) |
| `audio__convert_format` | `track_id, output_title, output_format:{extension}` | `result_clip_id`(对经过效果处理的音频会失败,建议改用 `GET /download/audio/{id}?format=mp3\|wav\|m4a`) |
| `audio__caption` | `prompt, audio_url` | `caption` |
| `audio__transcribe` | `audio_url` | `lyrics` |
| `lyrics__register` / `lyrics__edit` | `{lyrics}` → `lyrics_id`;`{prompt, lyrics_id}` | `lyrics` |
| `songs__get_metadata` | `clip_id` | 元数据,含 `model_display_name` |
| `audio__plan_edit` | `clip_ids, instruction` | `recipe_id`(代理用于自由形式的编辑) |
| 客户端中还见到的其他工具 | `audio__modify_song, video__create_music_video, playlists__*, songs__*` 等 | 用 `flowmusic tool` 调用 |

**歌词:** `lyrics_id = uuidv5(歌词文本, "b8f9e3a1-7c2d-4f5e-9a8b-1c3d5e7f9a2b")`,歌词文本本身放在
`client_context.lyrics_id_map[lyrics_id]` 中传递。id 为空表示没有歌词;`"[Instrumental]"` 表示纯音乐。
歌曲时长通过在歌词末尾追加 `[End - m:ss]` 控制(实测有效:2:00 → 约 119 秒,服务端最短约 60 秒);
BPM 通过在 sound prompt 末尾追加 `, N bpm` 控制。模型通过 `client_context.selected_model` 选择(可用模型见 `GET /models`)。
带歌词时,服务端有时会返回两个版本(`clip_id` + `clip_id_b`),CLI 中标记为 `[A]` / `[B]`。

**编辑(extend / replace / cover):** `POST /recipes/create {recipe:{nodes:[Input{clip_id}, <node>, Output{title,generate_image}], instruction}}`
→ `{recipe_id}`,再调用 `audio__render_edit`。节点类型:`ExtendSection{extend_s, extend_from_s}`、
`ReplaceSection{masks:[{start_s,end_s}]}`、`CoverSong{strength}`,都支持 `instruction, seed`。

### 用到的 REST 接口

`GET /billing/credits`、`GET /models`、`GET /clips/user/{uid}`、`POST /clips {clip_ids}`(返回 `audio_url`、`wav_url`、`image_url`、歌词、时长状态)、
`PATCH /clips/{id} {title|privacy}`、`POST /clips/delete {clip_ids}`、`GET /download/audio/{id}`、
`GET /audio-create-song-status/{operation_id}`、`GET/POST /playlists`、`POST /playlists/add {playlist_id, clip_ids}`、
`GET /projects`、`GET /conversations`、`POST /producer/upload-audio`(multipart:`file, file_type, filename`)、
`GET /producer/upload-audio/{id}/upload-check-status?operation_id=`。

完整的接口清单见 `captures/endpoints.tsv`(自动生成,已被 Git 忽略)。

### 其他接口

`POST /search/{clips|playlists|users} {query, limit}`、`GET /playlists/trending/{daily|weekly|monthly}`、`GET /featured/playlists`、
`POST /v2/generations/favorite {clip_id, is_favorite}`、`GET /clips/favorites`、`POST /batch-download-clip {clip_ids}`(zip)、
`PATCH|DELETE /playlists/{id}`、`DELETE /playlists/{id}/songs {clip_ids}`、`POST /projects {title, description}`、
`DELETE /conversations/{id}`、`GET /conversations/{id}/clip_count`。

## 未覆盖 / 未测试

音乐视频生成、带人声的上传(`--remove-vocals` 及确认流程是按网页客户端实现的,但未经测试)、DAW 插件、
Spaces、计费。其他工具可通过 `flowmusic tool <name> '<json>'` 调用。
这是非官方、未公开文档的接口,可能随时变化,恕不另行通知。

## 给 AI 代理使用的技能

`skills/` 目录里是供 AI 代理使用的技能:`flowmusic-cli`(入口与路由,含就绪检查)、`flowmusic-generate`、
`flowmusic-edit`、`flowmusic-library`、`flowmusic-troubleshoot`。`.agents/skills.json` 把它们注册给
Antigravity;其他代理可以把 `skills/*` 复制或软链接到各自的技能目录。
