const Parser = require('rss-parser');
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  }
});
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getConfig } = require('./chzzkNotifier');

const lastTweetMap = new Map();

// 2026년 기준 봇/스크립트 RSS 피드 응답이 정상 작동하는 미러 서버 목록
const FEED_MIRRORS = [
  (user) => `https://nitter.kareem.one/${user}/rss`,
  (user) => `https://nitter.meowing.monster/${user}/rss`,
  (user) => `https://shitter.thepixora.com/${user}/rss`,
  (user) => `https://rsshub.app/twitter/user/${user}`
];

async function fetchTweetFeed(username) {
  for (const getUrl of FEED_MIRRORS) {
    try {
      const rssUrl = getUrl(username);
      const feed = await parser.parseURL(rssUrl);
      if (feed && feed.items && feed.items.length > 0) {
        return feed;
      }
    } catch (e) {
      continue; // 차단되거나 중단된 미러는 우회하여 다음 미러 시도
    }
  }
  return null;
}

async function checkLatestTweet(username, discordChannel) {
  try {
    const feed = await fetchTweetFeed(username);
    if (!feed || !feed.items || feed.items.length === 0) return;

    const latestTweet = feed.items[0];
    const tweetId = latestTweet.guid || latestTweet.link;

    if (lastTweetMap.get(username) === tweetId) return;

    if (!lastTweetMap.has(username)) {
      lastTweetMap.set(username, tweetId);
      return;
    }

    lastTweetMap.set(username, tweetId);

    let rawContent = latestTweet.contentSnippet || latestTweet.content || '';
    let link = latestTweet.link || `https://x.com/${username}`;

    // 스페이스 URL 패턴 감지 (x.com/i/spaces/ 또는 twitter.com/i/spaces/)
    const spaceMatch = rawContent.match(/https?:\/\/(x|twitter)\.com\/i\/spaces\/[a-zA-Z0-9]+/i) ||
                       link.match(/https?:\/\/(x|twitter)\.com\/i\/spaces\/[a-zA-Z0-9]+/i);

    const displayName = feed.title ? feed.title.replace(/ \/ Twitter| \/ X/g, '').trim() : username;
    const authorName = `${displayName} (@${username})`;

    // 1. 트위터 스페이스 알림
    if (spaceMatch) {
      const spaceUrl = spaceMatch[0].replace('twitter.com', 'x.com');

      const embed = new EmbedBuilder()
        .setColor('#8a2be2') // 보라색 테두리
        .setAuthor({
          name: authorName,
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        })
        .setTitle(`${displayName}님이 트위터 스페이스를 시작했어요!`)
        .setDescription(`${spaceUrl}\n\n**Master URL:** [Link](${spaceUrl})\n**Final URL:** [Link](${spaceUrl})`)
        .setTimestamp(new Date(latestTweet.pubDate || Date.now()))
        .setFooter({
          text: 'Twitter',
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        });

      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('스페이스 입장')
          .setURL(spaceUrl)
          .setStyle(ButtonStyle.Link)
      );

      await discordChannel.send({ embeds: [embed], components: [btn] });
    } 
    // 2. 일반 트윗 알림
    else {
      let content = rawContent.replace(/<[^>]*>/g, '').trim() || '내용 없음';

      const embed = new EmbedBuilder()
        .setColor('#1DA1F2')
        .setAuthor({
          name: authorName,
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        })
        .setTitle(latestTweet.title ? latestTweet.title.substring(0, 256) : '새 트윗이 등록되었습니다.')
        .setURL(link)
        .setDescription(content)
        .setTimestamp(new Date(latestTweet.pubDate || Date.now()))
        .setFooter({ text: 'Twitter (X) 알림' });

      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('트윗 보러가기')
          .setURL(link)
          .setStyle(ButtonStyle.Link)
      );

      await discordChannel.send({ embeds: [embed], components: [btn] });
    }
  } catch (error) {
    console.log(`[Twitter Monitor] @${username} 트윗 수신 확인 중...`);
  }
}

async function startTwitterMonitoring(client) {
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
  }, 180000); // 3분 주기
}

module.exports = { checkLatestTweet, startTwitterMonitoring };