# 614宿舍综合平台

前端主文件是 `614宿舍综合平台.html`。直接打开可以使用本地版；运行后端后可以把用户操作同步到云端。

## 本地运行

```bash
npm start
```

打开 `http://localhost:3000`。

管理员账号：`13246429006`  
管理员密码：`102906`

## GitHub 云端同步

不要把 GitHub Token 写进 HTML。把下面环境变量配置在服务器平台里：

```bash
GITHUB_TOKEN=你的GitHubToken
GITHUB_OWNER=你的GitHub用户名或组织
GITHUB_REPO=仓库名
GITHUB_BRANCH=main
GITHUB_DATA_PATH=cloud/events.json
```

前端会把操作记录 POST 到 `/api/events`，后端会写入 `data/events.json`，并在配置 GitHub 后自动提交到仓库里的 `cloud/events.json`。
