const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

const CONFIG_PATH = path.join(__dirname, 'config.json');
const lastVideoState = {};
const channelIconCache = {}; // 채널 프로필 이미지 캐시

function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// 유튜브 채널 프로필 및 정보 가져오기
async function getYoutubeChannelInfo(channelId) {
  if (channelIconCache[channelId]) return channelIconCache[channelId];

  try {
    const res = await youtube.channels.list({
      part: ['snippet'],
      id: [channelId]
    });

    if (res.data.items && res.data.items.length > 0) {
      const item = res.data.items[0].snippet;
      const info = {
        title: item.title,
        icon: item.thumbnails?.default?.url || item.thumbnails?.high?.url || ''
      };
      channelIconCache[channelId] = info;
      return info;
    }
  } catch (e) {
    console.error(`[YouTube Channel Info Error] ${channelId}:`, e.message);
  }
  return { title: '유튜브 채널', icon: '' };
}

// 유튜브 최신 영상 검사 및 디스코드 메시지 전송
async function startYoutubeMonitoring(client) {
  setInterval(async () => {
    const config = getConfig();
    if (!config.youtube) return;

    for (const channelId in config.youtube) {
      const target = config.youtube[channelId];
      if (!target.channelId) continue;

      try {
        const searchRes = await youtube.search.list({
          part: ['snippet'],
          channelId: channelId,
          order: 'date',
          maxResults: 1
        });

        if (!searchRes.data.items || searchRes.data.items.length === 0) continue;

        const latestItem = searchRes.data.items[0];
        const videoId = latestItem.id?.videoId;
        if (!videoId) continue;

        const videoTitle = latestItem.snippet.title;
        const channelTitle = latestItem.snippet.channelTitle;
        
        // 채널 프로필 아이콘 조회
        const channelInfo = await getYoutubeChannelInfo(channelId);
        const profileIcon = channelInfo.icon || 'https://upload.wikimedia.org/wikipedia/commons/e/ef/YouTube_action_scraps_light.png';

        // Shorts 구분
        const isShorts = videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short');
        const videoUrl = isShorts 
          ? `https://www.youtube.com/shorts/${videoId}` 
          : `https://www.youtube.com/watch?v=${videoId}`;

        const prevVideoId = lastVideoState[channelId];

        // 새 영상 감지 시 2번째 사진 양식으로 발송
        if (prevVideoId && prevVideoId !== videoId) {
          const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
          if (discordChannel) {
            
            // 1. 상단 알림 임베드 (프로필 아이콘 정상 출력 + 썸네일 작게 우측 배치)
            const embed = new EmbedBuilder()
              .setColor('#FF0000')
              .setAuthor({ 
                name: channelTitle, 
                iconURL: profileIcon 
              })
              .setTitle(videoTitle)
              .setURL(videoUrl)
              .setThumbnail(latestItem.snippet.thumbnails?.default?.url || latestItem.snippet.thumbnails?.high?.url)
              .setFooter({ text: 'Youtube' })
              .setTimestamp(new Date(latestItem.snippet.publishedAt || Date.now()));

            // 2. 메시지 본문에 videoUrl 전송 ➔ 디스코드 하단 큰 동영상 플레이어 자동 생성
            await discordChannel.send({
              content: `${videoUrl}`,
              embeds: [embed]
            });
          }
        }

        lastVideoState[channelId] = videoId;

      } catch (err) {
        console.error(`[YouTube Monitor Error] ${channelId}:`, err.message);
      }
    }
  }, 60000); // 1분 간격
}

module.exports = { startYoutubeMonitoring, getYoutubeChannelInfo, getConfig, saveConfig };