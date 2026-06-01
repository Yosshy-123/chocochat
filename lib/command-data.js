'use strict';

const PUBLIC_COMMANDS = [
  { name: '/help',    desc: 'ヘルプを表示' },
  { name: '/omikuji', desc: 'おみくじを引く' },
  { name: '/dice',    desc: 'サイコロを振る（1〜6）' },
  { name: '/coin',    desc: 'コインを投げる（表/裏）' },
  { name: '/color',   desc: '名前の色を変更', example: '例: /color #ff0000' },
  { name: '/pm',      desc: '個別メッセージを送信', example: '例: /pm ユーザーID 内容' },
];

const ADMIN_COMMANDS = [
  { name: '/delete',        desc: '全メッセージを削除' },
  { name: '/rule',          desc: '全体または指定ユーザーへルール案内を送信', example: '例: /rule ユーザーID' },
  { name: '/mute',          desc: 'ユーザーを一時ミュート', example: '例: /mute ユーザーID 10' },
  { name: '/unmute',        desc: 'ユーザーのミュートを解除', example: '例: /unmute ユーザーID' },
  { name: '/mutelist',      desc: 'ミュート中ユーザー一覧を表示' },
  { name: '/ban',           desc: 'ユーザーをBAN', example: '例: /ban ユーザーID' },
  { name: '/unban',         desc: 'ユーザーのBANを解除', example: '例: /unban ユーザーID' },
  { name: '/banlist',       desc: 'BAN中ユーザー一覧を表示' },
  { name: '/shadowban',     desc: 'ユーザーをシャドウBAN', example: '例: /shadowban ユーザーID' },
  { name: '/shadowunban',   desc: 'ユーザーのシャドウBANを解除', example: '例: /shadowunban ユーザーID' },
  { name: '/shadowbanlist', desc: 'シャドウBAN中ユーザー一覧を表示' },
];

const SUPER_ADMIN_COMMANDS = [
  { name: '/addadmin',    desc: '指定ユーザーに管理者権限を付与', example: '例: /addadmin ユーザーID' },
  { name: '/removeadmin', desc: '指定ユーザーの管理者権限を削除', example: '例: /removeadmin ユーザーID' },
  { name: '/adminlist',   desc: '管理者一覧を表示' },
];

function buildHelpText(options = {}) {
  const { isAdmin = false, isSuperAdmin = false } = options;
  const sections = [['【基本コマンド】', PUBLIC_COMMANDS]];

  if (isAdmin || isSuperAdmin) {
    sections.push(['【管理者】', ADMIN_COMMANDS]);
  }
  if (isSuperAdmin) {
    sections.push(['【ADMIN】', SUPER_ADMIN_COMMANDS]);
  }

  return sections
    .map(([title, items]) => [
      title,
      ...items.map(item => {
        if (!item.name) return item.desc;
        return item.example
          ? `${item.name} - ${item.desc}\n${item.example}`
          : `${item.name} - ${item.desc}`;
      }),
    ].join('\n'))
    .join('\n\n');
}

function buildRuleText(username) {
  return [
    `こんにちは、${username}です。`,
    'このサーバーのルールをご案内します。',
    '',
    '【ルール】',
    '他の人が嫌がることはしないでください。',
    '例:',
    '・暴言や相手を傷つける発言',
    '・過度な発言や迷惑行為',
    '・ログイン／ログアウトの繰り返し',
    '',
    '【補足】',
    '役職の有無による上下関係はありません。',
    'お互いが問題なければ、タメ口で気軽に交流していただいて大丈夫です。',
    '',
    '【注意事項】',
    'ルールに違反する行為が確認された場合は、内容に応じて対応します。',
    '誰でも気持ちよく過ごせるよう、ご協力をお願いします。',
  ].join('\n');
}

function getCommandCards(options = {}) {
  const { isAdmin = false, isSuperAdmin = false } = options;
  const cards = [...PUBLIC_COMMANDS];
  if (isAdmin || isSuperAdmin) cards.push(...ADMIN_COMMANDS);
  if (isSuperAdmin) cards.push(...SUPER_ADMIN_COMMANDS);
  return cards;
}

module.exports = {
  PUBLIC_COMMANDS,
  ADMIN_COMMANDS,
  SUPER_ADMIN_COMMANDS,
  buildHelpText,
  buildRuleText,
  getCommandCards,
};
