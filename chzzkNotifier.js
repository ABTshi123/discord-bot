const fs = require('fs');
const path = require('path');
const { ChzzkClient } = require('chzzk');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const chzzk = new ChzzkClient();
const CONFIG_PATH = path.join(__dirname, 'config.json');

const lastLiveStatus = {};

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

async function getChannelName(channelId) {
  try {
    let channel = null;
    if (typeof chzzk.channel?.get === 'function') {
      channel = await chzzk.channel.get(channelId);
    } else if (typeof chzzk.channel === 'function') {
      channel = await chzzk.channel(channelId);
    }
    
    if (channel && channel.channelName) {
      return channel.channelName;
    }
  } catch (e) {
    console.error(`[Chzzk Channel Error] ${channelId}:`, e.message);
  }
  return '스트리머';
}

async function fetchLiveDetail(channelId) {
  try {
    if (typeof chzzk.live?.detail === 'function') {
      return await chzzk.live.detail(channelId);
    }
    if (typeof chzzk.live?.get === 'function') {
      return await chzzk.live.get(channelId);
    }
    if (typeof chzzk.channel?.getLiveDetail === 'function') {
      return await chzzk.channel.getLiveDetail(channelId);
    }
  } catch (e) {
    console.error(`[Chzzk Fetch Error] ${channelId}:`, e.message);
  }
  return null;
}

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

        if (isLive && !wasLive) {
          const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
          if (discordChannel) {
            const liveTitle = liveDetail.liveTitle || '제목 없음';
            const streamerName = target.name || liveDetail.channel?.channelName || '스트리머';
            const category = liveDetail.liveCategoryValue || '카테고리 없음';
            const liveImageUrl = liveDetail.liveImageUrl ? liveDetail.liveImageUrl.replace('{type}', '720') : null;
            const profileImageUrl = liveDetail.channel?.channelImageUrl || null;

            const embed = new EmbedBuilder()
              .setColor(0x4287f5) // 예시 이미지와 동일한 파란색 사이드바
              .setAuthor({ name: streamerName, iconURL: profileImageUrl })
              .setTitle(`🟢 ${streamerName}님이 치지직 방송을 시작했습니다!`)
              .setDescription(`\`\`\`yaml\n${liveTitle}\n\`\`\``) // 하늘색 강조 텍스트 스타일 적용
              .addFields(
                { name: '스트리머', value: `\`${streamerName}\``, inline: true },
                { name: '카테고리', value: `\`${category}\``, inline: true }
              )
              .setImage(liveImageUrl)
              .setFooter({ text: 'Chzzk Notification' })
              .setTimestamp();

            const btn = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setLabel('치지직 방송 보러가기')
                .setURL(`[https://chzzk.naver.com/live/$](https://chzzk.naver.com/live/$){channelId}`)
                .setStyle(ButtonStyle.Link)
            );

            await discordChannel.send({ embeds: [embed], components: [btn] });
          }
        }

        lastLiveStatus[channelId] = isLive;

      } catch (err) {
        console.error(`[Chzzk Monitor Error] ${channelId}:`, err.message);
      }
    }
  }, 60000);
}

module.exports = { startChzzkMonitoring, getConfig, saveConfig, getChannelName };