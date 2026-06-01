'use strict';

window.CommandHelp = {
  PUBLIC_COMMANDS: [
    { name: '/help',    desc: 'ヘルプを表示' },
    { name: '/omikuji', desc: 'おみくじを引く' },
    { name: '/dice',    desc: 'サイコロを振る（1〜6）' },
    { name: '/coin',    desc: 'コインを投げる（表/裏）' },
    { name: '/color',   desc: '名前の色を変更', example: '例: /color #ff0000' },
    { name: '/pm',      desc: '個別メッセージを送信', example: '例: /pm ユーザーID 内容' },
  ],

  ADMIN_COMMANDS: [
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
  ],

  SUPER_ADMIN_COMMANDS: [
    { name: '/addadmin',    desc: '指定ユーザーに管理者権限を付与', example: '例: /addadmin ユーザーID' },
    { name: '/removeadmin', desc: '指定ユーザーの管理者権限を削除', example: '例: /removeadmin ユーザーID' },
    { name: '/adminlist',   desc: '管理者一覧を表示' },
  ],

  getCommandCards(options = {}) {
    const { isAdmin = false, isSuperAdmin = false } = options;
    const cards = [...this.PUBLIC_COMMANDS];
    if (isAdmin || isSuperAdmin) cards.push(...this.ADMIN_COMMANDS);
    if (isSuperAdmin) cards.push(...this.SUPER_ADMIN_COMMANDS);
    return cards;
  },
};
