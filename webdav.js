// WebDAV 配置存储
let webdavConfig = {
  url: "",
  username: "",
  password: "",
  basePath: "/"
};

// 创建 WebDAV 客户端
function createWebDAVClient() {
  if (!webdavConfig.url) {
    return null;
  }
  const { createClient } = require("webdav");
  return createClient(webdavConfig.url, {
    username: webdavConfig.username,
    password: webdavConfig.password
  });
}

// 支持的音频格式
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.ape', '.opus'];

// 检查文件是否为音频文件
function isAudioFile(filename) {
  const ext = getExtension(filename).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

// 获取文件扩展名
function getExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot);
}

// 获取文件名（不含扩展名）
function getBasename(filename) {
  const lastSlash = filename.lastIndexOf('/');
  const name = lastSlash === -1 ? filename : filename.substring(lastSlash + 1);
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? name : name.substring(0, lastDot);
}

// 获取所在目录路径
function getDirname(filePath) {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash === -1 ? '/' : filePath.substring(0, lastSlash) || '/';
}

// 从文件名解析歌曲信息
function parseMusicInfo(filename) {
  const nameWithoutExt = getBasename(filename);
  // 尝试解析 "艺术家 - 标题" 格式
  const match = nameWithoutExt.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (match) {
    return {
      artist: match[1].trim(),
      title: match[2].trim()
    };
  }
  // 默认使用文件名作为标题
  return {
    artist: "未知艺术家",
    title: nameWithoutExt.trim()
  };
}

// 生成唯一ID
function generateId(filePath) {
  let result = '';
  for (let i = 0; i < filePath.length; i++) {
    result += filePath.charCodeAt(i).toString(36) + '-';
  }
  return result.slice(0, -1);
}

// 从ID解析文件路径
function getPathFromId(id) {
  const parts = id.split('-');
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      result += String.fromCharCode(parseInt(parts[i], 36));
    }
  }
  return result || id;
}

// 拼接路径
function joinPath(...parts) {
  return parts.map(p => p.replace(/^\/+|\/+$/g, '')).filter(p => p).join('/');
}

module.exports = {
  platform: "WebDAV",
  version: "1.0.0",
  author: "异飨客",
  description: "连接 WebDAV 服务器播放音乐",
  srcUrl: "",
  cacheControl: "no-cache",

  // 提示文案
  hints: {
    importMusicSheet: [
      "1. 输入 WebDAV 服务器的文件夹路径作为歌单",
      "2. 格式: /music/playlist 或 music/playlist",
      "3. 确保路径下包含音频文件"
    ]
  },

  // 初始化配置
  async init(config) {
    if (config) {
      webdavConfig.url = config.url || webdavConfig.url;
      webdavConfig.username = config.username || webdavConfig.username;
      webdavConfig.password = config.password || webdavConfig.password;
      webdavConfig.basePath = config.basePath || webdavConfig.basePath;
    }
  },

  // 搜索音乐
  async search(query, page, type) {
    if (type !== "music") {
      return { isEnd: true, data: [] };
    }

    const client = createWebDAVClient();
    if (!client) {
      return { isEnd: true, data: [] };
    }

    try {
      const results = [];
      const searchPath = webdavConfig.basePath || "/";
      
      // 递归搜索文件
      async function searchDirectory(dirPath) {
        const items = await client.getDirectoryContents(dirPath);
        
        for (const i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type === "directory") {
            // 递归搜索子目录
            await searchDirectory(item.filename);
          } else if (isAudioFile(item.basename)) {
            const musicInfo = parseMusicInfo(item.basename);
            // 检查是否匹配搜索关键词
            if (musicInfo.title.toLowerCase().includes(query.toLowerCase()) ||
                musicInfo.artist.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                id: generateId(item.filename),
                platform: "WebDAV",
                artist: musicInfo.artist,
                title: musicInfo.title,
                album: "",
                artwork: "",
                duration: 0,
                url: ""
              });
            }
          }
        }
      }

      await searchDirectory(searchPath);
      
      // 分页处理
      const pageSize = 20;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const pageData = results.slice(startIndex, endIndex);
      
      return {
        isEnd: endIndex >= results.length,
        data: pageData
      };
    } catch (error) {
      console.error("WebDAV search error:", error);
      return { isEnd: true, data: [] };
    }
  },

  // 获取音乐的真实 URL
  async getMediaSource(musicItem, quality) {
    const client = createWebDAVClient();
    if (!client) {
      return null;
    }

    try {
      const filePath = getPathFromId(musicItem.id);
      // 获取文件的直接下载链接
      const downloadLink = client.getFileDownloadLink(filePath);
      return {
        url: downloadLink
      };
    } catch (error) {
      console.error("WebDAV getMediaSource error:", error);
      return null;
    }
  },

  // 获取音乐详情
  async getMusicInfo(musicItem) {
    const client = createWebDAVClient();
    if (!client) {
      return musicItem;
    }

    try {
      const filePath = getPathFromId(musicItem.id);
      const stat = await client.stat(filePath);
      
      return {
        id: musicItem.id,
        platform: "WebDAV",
        artist: musicItem.artist,
        title: musicItem.title,
        album: musicItem.album,
        artwork: musicItem.artwork,
        duration: musicItem.duration,
        url: musicItem.url
      };
    } catch (error) {
      return musicItem;
    }
  },

  // 获取歌词
  async getLyric(musicItem) {
    const client = createWebDAVClient();
    if (!client) {
      return { rawLrc: "" };
    }

    try {
      const filePath = getPathFromId(musicItem.id);
      const dirPath = getDirname(filePath);
      const fileName = getBasename(filePath);
      
      // 尝试查找同名的 .lrc 歌词文件
      const lrcPath = dirPath === '/' ? '/' + fileName + ".lrc" : dirPath + '/' + fileName + ".lrc";
      
      try {
        const lrcContent = await client.getFileContents(lrcPath, { format: "text" });
        return { rawLrc: lrcContent };
      } catch (e) {
        // 歌词文件不存在
        return { rawLrc: "" };
      }
    } catch (error) {
      return { rawLrc: "" };
    }
  },

  // 导入单曲（通过路径）
  async importMusicItem(urlLike) {
    const client = createWebDAVClient();
    if (!client) {
      return null;
    }

    try {
      const filePath = urlLike.startsWith("/") ? urlLike : "/" + urlLike;
      
      if (!isAudioFile(filePath)) {
        return null;
      }

      const stat = await client.stat(filePath);
      const baseName = stat.basename || filePath.substring(filePath.lastIndexOf('/') + 1);
      const musicInfo = parseMusicInfo(baseName);
      
      return {
        id: generateId(filePath),
        platform: "WebDAV",
        artist: musicInfo.artist,
        title: musicInfo.title,
        album: "",
        artwork: "",
        duration: 0,
        url: ""
      };
    } catch (error) {
      console.error("WebDAV importMusicItem error:", error);
      return null;
    }
  },

  // 导入歌单（文件夹作为歌单）
  async importMusicSheet(urlLike) {
    const client = createWebDAVClient();
    if (!client) {
      return { musicList: [] };
    }

    try {
      const folderPath = urlLike.startsWith("/") ? urlLike : "/" + urlLike;
      const items = await client.getDirectoryContents(folderPath);
      
      const musicList = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "file" && isAudioFile(item.basename)) {
          const musicInfo = parseMusicInfo(item.basename);
          musicList.push({
            id: generateId(item.filename),
            platform: "WebDAV",
            artist: musicInfo.artist,
            title: musicInfo.title,
            album: "",
            artwork: "",
            duration: 0,
            url: ""
          });
        }
      }
      
      return {
        musicList: musicList
      };
    } catch (error) {
      console.error("WebDAV importMusicSheet error:", error);
      return { musicList: [] };
    }
  },

  // 获取专辑信息（文件夹作为专辑）
  async getAlbumInfo(albumItem, page) {
    const client = createWebDAVClient();
    if (!client) {
      return { isEnd: true, musicList: [] };
    }

    try {
      const folderPath = getPathFromId(albumItem.id);
      const items = await client.getDirectoryContents(folderPath);
      
      const musicList = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "file" && isAudioFile(item.basename)) {
          const musicInfo = parseMusicInfo(item.basename);
          musicList.push({
            id: generateId(item.filename),
            platform: "WebDAV",
            artist: musicInfo.artist,
            title: musicInfo.title,
            album: albumItem.title,
            artwork: albumItem.artwork || "",
            duration: 0,
            url: ""
          });
        }
      }
      
      return {
        isEnd: true,
        musicList: musicList
      };
    } catch (error) {
      console.error("WebDAV getAlbumInfo error:", error);
      return { isEnd: true, musicList: [] };
    }
  },

  // 获取推荐歌单标签（返回根目录下的文件夹）
  async getRecommendSheetTags() {
    const client = createWebDAVClient();
    if (!client) {
      return [];
    }

    try {
      const basePath = webdavConfig.basePath || "/";
      const items = await client.getDirectoryContents(basePath);
      
      const tags = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "directory") {
          tags.push({
            id: generateId(item.filename),
            title: item.basename,
            data: []
          });
        }
      }
      
      return tags;
    } catch (error) {
      console.error("WebDAV getRecommendSheetTags error:", error);
      return [];
    }
  },

  // 根据标签获取歌单
  async getRecommendSheetsByTag(tag, page) {
    if (!tag) {
      return { isEnd: true, data: [] };
    }

    const client = createWebDAVClient();
    if (!client) {
      return { isEnd: true, data: [] };
    }

    try {
      const folderPath = getPathFromId(tag.id);
      const items = await client.getDirectoryContents(folderPath);
      
      const sheets = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "directory") {
          sheets.push({
            id: generateId(item.filename),
            platform: "WebDAV",
            title: item.basename,
            artwork: "",
            description: "",
            worksNum: 0
          });
        }
      }
      
      return {
        isEnd: true,
        data: sheets
      };
    } catch (error) {
      console.error("WebDAV getRecommendSheetsByTag error:", error);
      return { isEnd: true, data: [] };
    }
  }
};
