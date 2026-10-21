const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

// 유튜브 최신 영상/라이브 검사 함수
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
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        const prevVideoId = lastVideoState[channelId];

        // 새로운 영상 감지 시 알림 전송
        if (prevVideoId && prevVideoId !== videoId) {
          const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
          if (discordChannel) {
            // 이미지 스타일처럼 파란색 글자 링크 형태의 Embed 생성
            const embed = new EmbedBuilder()
              .setColor(0xFF0000) // 이미지 좌측의 강렬한 빨간색 테두리
              .setAuthor({ 
                name: channelTitle, 
                iconURL: target.icon || 'https://upload.wikimedia.org/wikipedia/commons/e/ef/YouTube_action_scraps_light.png' 
              })
              .setTitle(videoTitle) // 파란색 링크 텍스트로 표시되는 제목
              .setURL(videoUrl)     // 클릭 시 해당 영상으로 이동
              .setFooter({ text: 'Youtube' })
              .setTimestamp(new Date(latestItem.snippet.publishedAt || Date.now()));

            // 메세지 본문에 링크(videoUrl)를 같이 적어주면 디스코드 자동 임베드 카드도 함께 출력됩니다.
            await discordChannel.send({
              content: `${videoUrl}`,
              embeds: [embed]
            });
          }
        }

        // 상태 업데이트
        lastVideoState[channelId] = videoId;

      } catch (err) {
        console.error(`[YouTube Monitor Error] ${channelId}:`, err.message);
      }
    }
  }, 60000); // 1분 간격
}

module.exports = { startYoutubeMonitoring, getYoutubeChannelInfo, getConfig, saveConfig };