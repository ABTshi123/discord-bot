const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ChzzkClient } = require('chzzk');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const chzzk = new ChzzkClient();
const CONFIG_PATH = path.join(__dirname, 'config.json');

// 방송 상태 저장 메모리
const lastLiveStatus = {};

function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// GitHub로 config.json 자동 푸시 함수
function pushConfigToGithub() {
  const commands = 'git add config.json && git commit -m "Auto-update config.json [skip ci]" && git push origin main';
  exec(commands, (error, stdout, stderr) => {
    if (error) {
      console.log('[Config Sync Notice] GitHub 동기화 진행 중...');
      return;
    }
    console.log('[Config Sync Success] config.json이 GitHub에 정상 동기화되었습니다.');
  });
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
  // 변경사항을 GitHub에 즉시 백업
  pushConfigToGithub();
}

// 치지직 라이브 상세 정보 안전 가져오기
async function fetchLiveDetail(channelId) {
  try {
    if (typeof chzzk.live?.detail === 'function') return await chzzk.live.detail(channelId);
    if (typeof chzzk.live?.get === 'function') return await chzzk.live.get(channelId);
    if (typeof chzzk.channel?.getLiveDetail === 'function') return await chzzk.channel.getLiveDetail(channelId);
  } catch (e) {
    console.error(`[Chzzk Fetch Error] ${channelId}:`, e.message);
  }
  return null;
}

// 치지직 모니터링 (1분 간격)
async function startChzzkMonitoring(client) {
  setInterval(async () => {
    const config = getConfig();
    if (!config.chzzk) return;

    for (const channelId in config.chzzk) {
      const target = config.chzzk[channelId];
      if (!target.channelId) continue;

      try {
        const liveDetail = await fetchLiveDetail(channelId);
        if (!liveDetail) continue;

        const isLive = liveDetail.status === 'OPEN';
        const wasLive = lastLiveStatus[channelId] || false;

        // 뱅온 (방송 시작) 감지
        if (isLive && !wasLive) {
          const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
          if (discordChannel) {
            const liveTitle = liveDetail.liveTitle || '제목 없음';
            const streamerName = target.name || liveDetail.channel?.channelName || '스트리머';
            const category = liveDetail.liveCategoryValue || '카테고리 없음';
            const liveImageUrl = liveDetail.liveImageUrl ? liveDetail.liveImageUrl.replace('{type}', '720') : null;
            const profileImageUrl = liveDetail.channel?.channelImageUrl || null;

            const embed = new EmbedBuilder()
              .setColor(0x00FFA3)
              .setAuthor({ name: streamerName, iconURL: profileImageUrl })
              .setTitle(`🟢 ${streamerName}님이 치지직 방송을 시작했습니다!`)
              .setDescription(`**[${liveTitle}]**`)
              .addFields({ name: '카테고리', value: category, inline: true })
              .setImage(liveImageUrl)
              .setFooter({ text: 'Chzzk Live Notification' })
              .setTimestamp();

            const btn = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setLabel('치지직 방송 보러가기')
                .setURL(`https://chzzk.naver.com/live/${channelId}`)
                .setStyle(ButtonStyle.Link)
            );

            await discordChannel.send({ embeds: [embed], components: [btn] });
          }
        }

        // 상태 업데이트
        lastLiveStatus[channelId] = isLive;

      } catch (err) {
        console.error(`[Chzzk Monitor Error] ${channelId}:`, err.message);
      }
    }
  }, 60000);
}

module.exports = { startChzzkMonitoring, getConfig, saveConfig };