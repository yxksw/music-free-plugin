# MusicFree WebDAV 插件

这是一个用于 [MusicFree](https://github.com/maotoumao/MusicFree) 音乐播放器的 WebDAV 插件，允许你播放存储在 WebDAV 服务器上的音乐文件。

## 功能特性

- 🔍 **搜索音乐**: 在 WebDAV 服务器中搜索音乐文件
- 📁 **导入歌单**: 将文件夹作为歌单导入
- 🎵 **播放音乐**: 支持多种音频格式 (MP3, FLAC, WAV, AAC, OGG, M4A, WMA, APE, OPUS)
- 📝 **歌词支持**: 自动加载同名的 .lrc 歌词文件
- 📂 **文件夹浏览**: 浏览 WebDAV 服务器上的文件夹结构

## 安装方法

### 方法一：从网络安装（推荐）

1. 打开 MusicFree 应用
2. 进入侧边栏 → 设置 → 插件设置
3. 点击"从网络安装插件"
4. 输入以下 URL：
   ```
   https://raw.githubusercontent.com/your-username/Music-Free-plugin/main/plugins.json
   ```
5. 点击确认，等待安装完成

### 方法二：本地安装

1. 下载 `webdav.js` 文件
2. 打开 MusicFree 应用
3. 进入侧边栏 → 设置 → 插件设置
4. 点击"安装本地插件"
5. 选择下载的 `webdav.js` 文件

## 配置说明

安装插件后，需要配置 WebDAV 服务器信息。在插件设置中找到 WebDAV 插件，点击配置：

```javascript
{
  "url": "https://your-webdav-server.com/dav",
  "username": "your-username",
  "password": "your-password",
  "basePath": "/music"
}
```

### 配置参数说明

| 参数 | 说明 | 必填 |
|------|------|------|
| `url` | WebDAV 服务器地址 | 是 |
| `username` | WebDAV 用户名 | 是 |
| `password` | WebDAV 密码 | 是 |
| `basePath` | 音乐文件的根路径，默认为 `/` | 否 |

## 使用方法

### 导入歌单

1. 在 MusicFree 中选择"导入歌单"
2. 选择 WebDAV 插件
3. 输入文件夹路径，例如：
   - `/music/我的歌单`
   - `music/流行歌曲`
4. 点击确认，插件会加载该文件夹下的所有音频文件

### 搜索音乐

1. 在搜索页面选择 WebDAV 插件
2. 输入关键词搜索
3. 插件会递归搜索 `basePath` 下的所有音频文件

### 歌词显示

插件会自动查找与音乐文件同名的 `.lrc` 文件。例如：
- 音乐文件：`/music/歌曲名.mp3`
- 歌词文件：`/music/歌曲名.lrc`

## 文件命名建议

为了更好地识别歌曲信息，建议使用以下命名格式：

```
艺术家 - 歌曲名.mp3
```

例如：
- `周杰伦 - 青花瓷.mp3`
- `林俊杰 - 江南.flac`

如果文件名不包含分隔符，插件会将整个文件名作为歌曲标题。

## 支持的音频格式

- MP3
- FLAC
- WAV
- AAC
- OGG
- M4A
- WMA
- APE
- OPUS

## 注意事项

1. **网络连接**: 确保 WebDAV 服务器可以正常访问
2. **文件权限**: 确保 WebDAV 用户有读取文件的权限
3. **路径格式**: 路径以 `/` 开头，例如 `/music/songs`
4. **性能考虑**: 搜索功能会递归遍历所有子文件夹，如果文件较多可能需要一些时间

## 常见问题

### Q: 无法连接到 WebDAV 服务器？

A: 请检查：
- URL 是否正确（需要包含协议，如 `https://`）
- 用户名和密码是否正确
- 服务器是否允许访问
- 网络连接是否正常

### Q: 搜索不到音乐文件？

A: 请检查：
- `basePath` 是否设置正确
- 音乐文件格式是否在支持列表中
- WebDAV 用户是否有读取权限

### Q: 歌词无法显示？

A: 确保歌词文件：
- 与音乐文件同名
- 扩展名为 `.lrc`
- 位于同一文件夹下

## 技术说明

本插件使用 MusicFree 内置的 `webdav` 库进行 WebDAV 通信，无需额外打包依赖。

### 插件协议实现

- `search` - 搜索音乐
- `getMediaSource` - 获取音乐播放地址
- `getMusicInfo` - 获取音乐详情
- `getLyric` - 获取歌词
- `importMusicItem` - 导入单曲
- `importMusicSheet` - 导入歌单
- `getAlbumInfo` - 获取专辑信息
- `getRecommendSheetTags` - 获取推荐标签
- `getRecommendSheetsByTag` - 根据标签获取歌单

## 开源协议

本项目基于 AGPL 3.0 协议开源。

## 更新日志

### v1.0.0
- 初始版本发布
- 支持基本的搜索、播放、导入功能
- 支持歌词加载
