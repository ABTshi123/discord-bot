const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: [['media:content', 'mediaContent'], ['enclosure', 'enclosure']]
  }
});
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const lastTweetMap = new Map();

/**
 * 트위터 RSS 피드를 감지하여 이미지 예쁜 임베드 카드로 디스코드에 전송
 */
async function checkLatestTweet(username, discordChannel) {
  try {
    // Nitter RSS 브릿지 사용
    const rssUrl = `https://nitter.net/${username}/rss`;
    const feed = await parser.parseURL(rssUrl);

    if (!feed.items || feed.items.length === 0) return;

    const latestTweet = feed.items[0];
    const tweetId = latestTweet.guid || latestTweet.link;

    // 감지 처리
    if (lastTweetMap.get(username) === tweetId) return;

    if (!lastTweetMap.has(username)) {
      lastTweetMap.set(username, tweetId);
      return;
    }

    lastTweetMap.set(username, tweetId);

    // 본문 텍스트 정리 (HTML 태그 제거)
    let content = latestTweet.contentSnippet || latestTweet.content || '내용 없음';
    content = content.replace(/<[^>]*>/g, '').trim();

    // 이미지 URL 추출 (RSS 내 미디어 항목 감지)
    let imageUrl = null;
    if (latestTweet.mediaContent && latestTweet.mediaContent.$&& latestTweet.mediaContent.$.url) {
      imageUrl = latestTweet.mediaContent.$.url;
    } else if (latestTweet.enclosure && latestTweet.enclosure.url) {
      imageUrl = latestTweet.enclosure.url;
    }

    // 디스코드 파란색 트위터 스타일 임베드 구축
    const embed = new EmbedBuilder()
      .setColor('#1DA1F2') // 트위터 파란색
      .setAuthor({
        name: `${feed.title || username} (@${username})`,
        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
      })
      .setDescription(content)
      .setFooter({
        text: 'Twitter',
        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
      })
      .setTimestamp(new Date(latestTweet.pubDate || Date.now()));

    // 트윗에 이미지가 첨부되어 있으면 임베드 이미지로 추가
    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    // 이미지 하단의 [링크 🔗] 이동 버튼 생성
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('링크')
        .setStyle(ButtonStyle.Link)
        .setURL(latestTweet.link)
    );

    // 디스코드 채널로 메시지 전송
    await discordChannel.send({ embeds: [embed], components: [row] });
  } catch (error) {
    console.log(`[Twitter Monitor] @${username} 트윗 업데이트 확인 중...`);
  }
}

module.exports = { checkLatestTweet };