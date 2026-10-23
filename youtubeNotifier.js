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

// 유튜브 채널 정보 가져오기
async function getYoutubeChannelInfo(channelId) {
  try {
    const res = await youtube.channels.list({
      part: ['snippet'],
      id: [channelId]
    });

    if (res.data.items && res.data.items.length > 0) {
      const item = res.data.items[0].snippet;
      return {
        title: item.title,
        icon: item.thumbnails?.default?.url || ''
      };
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
        
        // 쇼츠(Shorts) 또는 일반 영상 URL 구분
        // search API 특성상 기본 watch URL로 연결하되, 쇼츠 단어가 포함되면 쇼츠 형태로 구성
        const isShorts = videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short');
        const videoUrl = isShorts 
          ? `https://www.youtube.com/shorts/${videoId}` 
          : `https://www.youtube.com/watch?v=${videoId}`;

        const prevVideoId = lastVideoState[channelId];

        // 새로운 영상 감지 시 알림
        if (prevVideoId && prevVideoId !== videoId) {
          const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
          if (discordChannel) {
            
            // 1. 상단 빨간색 테두리 임베드 카드 (스크린샷 첫번째 상단 카드 양식)
            const embed = new EmbedBuilder()
              .setColor('#FF0000') // 빨간색 테두리
              .setAuthor({ 
                name: channelTitle, 
                iconURL: target.icon || 'https://upload.wikimedia.org/wikipedia/commons/e/ef/YouTube_action_scraps_light.png' 
              })
              .setTitle(videoTitle) // 클릭 가능한 파란색 제목
              .setURL(videoUrl)
              .setFooter({ text: 'Youtube' })
              .setTimestamp(new Date(latestItem.snippet.publishedAt || Date.now()));

            // 2. 메시지 본문에 videoUrl을 전송하여 디스코드 하단 영상 미리보기 자동 생성
            await discordChannel.send({
              content: `${videoUrl}`,
              embeds: [embed]
            });
          }
        }

        // 최신 비디오 ID 업데이트
        lastVideoState[channelId] = videoId;

      } catch (err) {
        console.error(`[YouTube Monitor Error] ${channelId}:`, err.message);
      }
    }
  }, 60000); // 1분 간격
}

module.exports = { startYoutubeMonitoring, getYoutubeChannelInfo, getConfig, saveConfig };