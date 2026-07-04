# assets/ — 产物路径约定

模块之间只通过文件产物交接。约定：

```
assets/
├── generated/                    # gitignore：pipeline / narrator 运行时产物
│   ├── <head>-<flow>-<viewport>/ #   BE-1 输出：before.webm, after.webm, pipeline-output.json
│   └── <pr>-report/              #   BE-2 输出：experience-diff.json, side-by-side.mp4, voiceover.mp3
└── fallback/                     # 必须提交（铁律 2）：预生成兜底产物
    ├── pr-a-checkout-happy-before.webm
    ├── pr-a-checkout-happy-after.webm
    ├── pr-a-report/experience-diff.json + side-by-side.mp4 + voiceover.mp3
    ├── pr-c-checkout-fail-report/...      # 追问片段
    └── transcripts/                        # 语音问题 transcript
```

## 铁律 2

所有现场环节必须有预生成兜底，且**提交进仓库**：主 demo 视频、追问视频、语音 transcript、PR 页面、report JSON、TTS 音轨。M2（Sat 22:00）后各 owner 把自己模块的兜底产物放进 `fallback/` 并 commit。
