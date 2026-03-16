/*
 * WebDAV Plugin for MusicFree
 * 支持连接 WebDAV 服务器播放音乐
 */

"use strict";

// 缓存数据
let cachedData = {
  client: null,
  url: null,
  username: null,
  password: null,
  searchPath: null,
  searchPathList: null,
  cacheFileList: null,
  lastFetchTime: 0,
  lyric: {},
};

// 缓存有效期（1小时）
const CACHE_TTL = 60 * 60 * 1000;

// 支持的音频格式
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.ape', '.opus'];

/**
 * 获取文件扩展名
 */
function getExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
}

/**
 * 检查文件是否为音频文件
 */
function isAudioFile(filename) {
  return AUDIO_EXTENSIONS.includes(getExtension(filename));
}

/**
 * 从文件名解析歌曲信息
 * 支持 "艺术家 - 标题" 格式
 */
function parseMusicInfo(filename) {
  const lastSlash = filename.lastIndexOf('/');
  const name = lastSlash === -1 ? filename : filename.substring(lastSlash + 1);
  const lastDot = name.lastIndexOf('.');
  const nameWithoutExt = lastDot === -1 ? name : name.substring(0, lastDot);

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

/**
 * 获取或创建WebDAV客户端
 */
function getClient() {
  // 从环境变量获取配置
  const userVars = env.getUserVariables
    ? env.getUserVariables()
    : env.userVariables || {};
  const { url, username, password, searchPath } = userVars;

  // 验证必要配置
  if (!url || !username || !password) {
    console.error("WebDAV配置不完整");
    return null;
  }

  // 检查配置是否变更
  const configChanged =
    cachedData.url !== url ||
    cachedData.username !== username ||
    cachedData.password !== password ||
    cachedData.searchPath !== searchPath;

  if (configChanged || !cachedData.client) {
    // 更新缓存数据
    cachedData = {
      client: null,
      url,
      username,
      password,
      searchPath: searchPath || null,
      searchPathList: searchPath
        ? searchPath
            .split(",")
            .map((path) => path.trim())
            .filter(Boolean)
        : ["/"],
      cacheFileList: null,
      lastFetchTime: 0,
      lyric: {},
    };

    // 创建新的WebDAV客户端
    try {
      const { createClient, AuthType } = require("webdav");
      cachedData.client = createClient(url, {
        authType: AuthType.Password,
        username,
        password,
      });
    } catch (error) {
      console.error("创建WebDAV客户端失败:", error);
      return null;
    }
  }

  return cachedData.client;
}

/**
 * 获取目录下的所有音频文件
 * 支持递归搜索子目录
 */
async function getAudioFilesFromDirectory(client, path, recursive = true) {
  try {
    const items = await client.getDirectoryContents(path);
    const audioFiles = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === "directory" && recursive) {
        // 递归搜索子目录
        const subDirFiles = await getAudioFilesFromDirectory(
          client,
          item.filename,
          recursive,
        );
        audioFiles.push(...subDirFiles);
      } else if (
        item.type === "file" &&
        (item.mime && item.mime.startsWith("audio") || isAudioFile(item.basename))
      ) {
        audioFiles.push(item);
      }
    }

    return audioFiles;
  } catch (error) {
    console.error(`获取目录 ${path} 内容失败:`, error);
    return [];
  }
}

/**
 * 搜索音乐
 */
async function searchMusic(query) {
  const client = getClient();
  if (!client) {
    return { isEnd: true, data: [] };
  }

  const now = Date.now();
  const cacheExpired = now - cachedData.lastFetchTime > CACHE_TTL;

  // 如果缓存为空或已过期，重新获取文件列表
  if (
    !cachedData.cacheFileList ||
    cachedData.cacheFileList.length === 0 ||
    cacheExpired
  ) {
    const searchPaths =
      cachedData.searchPathList && cachedData.searchPathList.length > 0
        ? cachedData.searchPathList
        : ["/"];

    const filePromises = searchPaths.map((path) =>
      getAudioFilesFromDirectory(client, path, true),
    );

    try {
      const results = await Promise.allSettled(filePromises);
      cachedData.cacheFileList = results
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value);
      cachedData.lastFetchTime = now;
    } catch (error) {
      console.error("获取音频文件列表失败:", error);
      cachedData.cacheFileList = [];
    }
  }

  // 如果没有查询关键词，返回所有文件
  if (!query || query.trim() === "") {
    return {
      isEnd: true,
      data: (cachedData.cacheFileList || []).map((file) => {
        const musicInfo = parseMusicInfo(file.basename || file.filename);
        return {
          id: file.filename,
          platform: "WebDAV",
          title: musicInfo.title,
          artist: musicInfo.artist,
          album: "",
          artwork: "",
          duration: 0,
          url: "",
        };
      }),
    };
  }

  // 根据关键词过滤
  const searchTerm = query.toLowerCase();
  const filteredFiles = (cachedData.cacheFileList || [])
    .filter((file) => {
      if (!file.basename) return false;
      return file.basename.toLowerCase().includes(searchTerm);
    })
    .map((file) => {
      const musicInfo = parseMusicInfo(file.basename);
      return {
        id: file.filename,
        platform: "WebDAV",
        title: musicInfo.title,
        artist: musicInfo.artist,
        album: "",
        artwork: "",
        duration: 0,
        url: "",
      };
    });

  return {
    isEnd: true,
    data: filteredFiles,
  };
}

/**
 * 获取歌单列表
 */
async function getTopLists() {
  getClient(); // 确保客户端初始化
  const searchPaths = cachedData.searchPathList || ["/"];

  return [
    {
      title: "全部歌曲",
      data: searchPaths.map((path) => ({
        title: path,
        id: path,
      })),
    },
  ];
}

/**
 * 获取歌单详情
 */
async function getTopListDetail(topListItem) {
  const client = getClient();
  if (!client || !topListItem || !topListItem.id) {
    return { musicList: [] };
  }

  try {
    const fileItems = await getAudioFilesFromDirectory(
      client,
      topListItem.id,
      false,
    );

    return {
      musicList: fileItems.map((item) => {
        const musicInfo = parseMusicInfo(item.basename || item.filename);
        return {
          id: item.filename,
          platform: "WebDAV",
          title: musicInfo.title,
          artist: musicInfo.artist,
          album: "",
          artwork: "",
          duration: 0,
          url: "",
        };
      }),
    };
  } catch (error) {
    console.error(`获取歌单详情失败 ${topListItem.id}:`, error);
    return { musicList: [] };
  }
}

/**
 * 获取媒体源URL
 */
function getMediaSource(musicItem) {
  const client = getClient();
  if (!client || !musicItem || !musicItem.id) {
    return { url: null };
  }

  try {
    return {
      url: client.getFileDownloadLink(musicItem.id),
    };
  } catch (error) {
    console.error("获取媒体源URL失败:", error);
    return { url: null };
  }
}

/**
 * 获取歌词
 */
async function getLyric(musicItem) {
  if (!musicItem || !musicItem.id) {
    return { rawLrc: "" };
  }

  // 检查缓存
  let content = cachedData.lyric[musicItem.id];
  if (content) {
    return {
      rawLrc: content,
      translation: content,
    };
  }

  const client = getClient();
  if (!client) {
    return { rawLrc: "" };
  }

  // 将音频文件后缀换成 .lrc
  const lastDot = musicItem.id.lastIndexOf(".");
  const lrcPath = lastDot === -1 ? musicItem.id + ".lrc" : musicItem.id.substring(0, lastDot) + ".lrc";

  try {
    // 读取歌词文件内容
    const content = await client.getFileContents(lrcPath, {
      format: "text",
    });

    cachedData.lyric[musicItem.id] = content;
    return {
      rawLrc: content,
      translation: content,
    };
  } catch (error) {
    // 歌词文件不存在或其他错误
    return { rawLrc: "" };
  }
}

/**
 * 搜索函数（主入口）
 */
function search(query, page, type) {
  if (type === "music") {
    return searchMusic(query);
  }
  return Promise.resolve({ isEnd: true, data: [] });
}

/**
 * 导入歌单（文件夹作为歌单）
 */
async function importMusicSheet(urlLike) {
  const client = getClient();
  if (!client) {
    return { musicList: [] };
  }

  try {
    const folderPath = urlLike.startsWith("/") ? urlLike : "/" + urlLike;
    const fileItems = await getAudioFilesFromDirectory(client, folderPath, false);

    return {
      musicList: fileItems.map((item) => {
        const musicInfo = parseMusicInfo(item.basename || item.filename);
        return {
          id: item.filename,
          platform: "WebDAV",
          title: musicInfo.title,
          artist: musicInfo.artist,
          album: "",
          artwork: "",
          duration: 0,
          url: "",
        };
      }),
    };
  } catch (error) {
    console.error("WebDAV importMusicSheet error:", error);
    return { musicList: [] };
  }
}

/**
 * 获取专辑信息（文件夹作为专辑）
 */
async function getAlbumInfo(albumItem, page) {
  const client = getClient();
  if (!client || !albumItem || !albumItem.id) {
    return { isEnd: true, musicList: [] };
  }

  try {
    const fileItems = await getAudioFilesFromDirectory(client, albumItem.id, false);

    return {
      isEnd: true,
      musicList: fileItems.map((item) => {
        const musicInfo = parseMusicInfo(item.basename || item.filename);
        return {
          id: item.filename,
          platform: "WebDAV",
          title: musicInfo.title,
          artist: musicInfo.artist,
          album: albumItem.title || "",
          artwork: albumItem.artwork || "",
          duration: 0,
          url: "",
        };
      }),
    };
  } catch (error) {
    console.error("WebDAV getAlbumInfo error:", error);
    return { isEnd: true, musicList: [] };
  }
}

// 导出模块
module.exports = {
  platform: "WebDAV",
  version: "1.0.1",
  author: "异飨客",
  description: "连接 WebDAV 服务器播放音乐",
  userVariables: [
    {
      key: "url",
      name: "WebDAV地址",
      hint: "例如: https://example.com/dav",
    },
    {
      key: "username",
      name: "用户名",
    },
    {
      key: "password",
      name: "密码",
      type: "password",
    },
    {
      key: "searchPath",
      name: "存放歌曲的路径",
      hint: "多个路径用逗号分隔，例如: /Music,/Audio",
    },
  ],
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

  // 主功能接口
  search,
  getTopLists,
  getTopListDetail,
  getMediaSource,
  getLyric,
  importMusicSheet,
  getAlbumInfo,
};
