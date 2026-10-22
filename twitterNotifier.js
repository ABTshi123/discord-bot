const https = require('https');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getConfig } = require('./chzzkNotifier');

const lastTweetMap = new Map();

// FxTwitter 및 FxEmbed API 백엔드
function fetchLatestTweetApi(username) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.fxtwitter.com',
      path: `/${username}/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DiscordBot'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const data = JSON.parse(body);
            if (data && data.tweet) resolve(data.tweet);
            else resolve(null);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

async function checkLatestTweet(username, discordChannel) {
  try {
    const tweet = await fetchLatestTweetApi(username);
    if (!tweet || !tweet.id) return;

    const tweetId = tweet.id;

    // 이미 감지해서 알림을 보낸 트윗이면 중복 발송 방지
    if (lastTweetMap.get(username) === tweetId) return;

    // 💡 최신 트윗 ID 업데이트
    lastTweetMap.set(username, tweetId);

    const tweetUrl = tweet.url || `https://x.com/${username}/status/${tweetId}`;
    const rawContent = tweet.text || '';
    const authorName = `${tweet.author?.name || username} (@${username})`;
    const profileImg = tweet.author?.avatar_url || 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png';

    // 트위터 스페이스 URL 패턴 감지
    const spaceMatch = rawContent.match(/https?:\/\/(x|twitter)\.com\/i\/spaces\/[a-zA-Z0-9]+/i) ||
                       tweetUrl.match(/https?:\/\/(x|twitter)\.com\/i\/spaces\/[a-zA-Z0-9]+/i);

    // 1. 트위터 스페이스 알림 (보라색 카드)
    if (spaceMatch) {
      const spaceUrl = spaceMatch[0].replace('twitter.com', 'x.com');

      const embed = new EmbedBuilder()
        .setColor('#8a2be2')
        .setAuthor({ name: authorName, iconURL: profileImg })
        .setTitle(`${tweet.author?.name || username}님이 트위터 스페이스를 시작했어요!`)
        .setDescription(`${spaceUrl}\n\n**Master URL:** [Link](${spaceUrl})\n**Final URL:** [Link](${spaceUrl})`)
        .setTimestamp(new Date(tweet.created_at || Date.now()))
        .setFooter({ text: 'Twitter', iconURL: profileImg });

      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('스페이스 입장')
          .setURL(spaceUrl)
          .setStyle(ButtonStyle.Link)
      );

      await discordChannel.send({ embeds: [embed], components: [btn] });
    } 
    // 2. 일반 트윗 알림 (파란색 카드)
    else {
      const embed = new EmbedBuilder()
        .setColor('#1DA1F2')
        .setAuthor({ name: authorName, iconURL: profileImg })
        .setTitle('새 트윗이 등록되었습니다.')
        .setURL(tweetUrl)
        .setDescription(rawContent || '내용 없음')
        .setTimestamp(new Date(tweet.created_at || Date.now()))
        .setFooter({ text: 'Twitter (X) 알림' });

      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('트윗 보러가기')
          .setURL(tweetUrl)
          .setStyle(ButtonStyle.Link)
      );

      await discordChannel.send({ embeds: [embed], components: [btn] });
    }
  } catch (error) {
    console.log(`[Twitter Monitor] @${username} 트윗 수신 확인 중...`);
  }
}

async function startTwitterMonitoring(client) {
  // 1분 간격 주기 모니터링
  setInterval(async () => {
    const config = getConfig();
    if (!config.twitter) return;

    for (const twitterId in config.twitter) {
      const target = config.twitter[twitterId];
      if (!target.channelId) continue;

      try {
        const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
        if (discordChannel) {
          await checkLatestTweet(twitterId, discordChannel);
        }
      } catch (err) {
        console.error(`[Twitter Monitor Error] @${twitterId}:`, err.message);
      }
    }
  }, 60000); // 60초 간격
}

module.exports = { checkLatestTweet, startTwitterMonitoring };