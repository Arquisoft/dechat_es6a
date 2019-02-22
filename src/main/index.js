"use strict";

const Core = require('../lib/core');
const auth = require('solid-auth-client');
const { default: data } = require('@solid/query-ldflex');
const namespaces = require('../lib/namespaces');
const DataSync = require('../lib/datasync');

let core = new Core(auth.fetch);
let userWebId;
let interlocWebId;
let refreshIntervalId;
let dataSync = new DataSync(auth.fetch);
let userDataUrl;
let chatsToJoin = [];
let semanticChat;

$('.login-btn').click(() => {
  auth.popupLogin({ popupUri: 'popup.html' });
});

$('#logout-btn').click(() => {
  auth.logout();
});

auth.trackSession(async session => {
  const loggedIn = !!session;
  //alert(`logged in: ${loggedIn}`);

  if (loggedIn) {
    $('#user-menu').removeClass('hidden');
    $('#nav-login-btn').addClass('hidden');
    $('#login-required').modal('hide');

    userWebId = session.webId;
    const name =await core.getFormattedName(userWebId);

    if (name) {
      $('#user-name').removeClass('hidden');
      $('#user-name').text(name);
    }

    //checkForNotifications();
    // refresh every 5sec
    refreshIntervalId = setInterval(checkForNotifications, 5000);
  } else {
	  //alert("you're not logged in");
    $('#nav-login-btn').removeClass('hidden');
    $('#user-menu').addClass('hidden');
    $('#new-chat-options').addClass('hidden');
    userWebId = null;
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
});

function afterChatOption() {
  $('#chat-options').addClass('hidden');
}

$('#new-btn').click(async () => {
  if (userWebId) {
    afterChatOption();
    $('#new-chat-options').removeClass('hidden');
 	$('#data-url').prop('value', core.getDefaultDataUrl(userWebId));

    const $select = $('#contacts');

    for await (const friend of data[userWebId].friends) {
        let name = await core.getFormattedName(friend.value);

        $select.append(`<option value="${friend}">${name}</option>`);
    }
  } else {
	  //alert("NOT logged in");
    $('#login-required').modal('show');
  }
});

$('#start-new-chat-btn').click(async () => {
  const dataUrl = $('#data-url').val();

  if (await core.writePermission(dataUrl, dataSync)) {
    $('#new-chat-options').addClass('hidden');
    interlocWebId = $('#contacts').val();
    userDataUrl = dataUrl;
    setUpNewConversation();
  } else {
    $('#write-permission-url').text(dataUrl);
    $('#write-permission').modal('show');
  }
});

async function setUpNewConversation() {
  //Initialize conversation
}

$('#join-btn').click(async () => {
  if (userWebId) {
    afterChatOption();
    $('#join-chat-options').removeClass('hidden');
    $('#join-data-url').prop('value', core.getDefaultDataUrl(userWebId));
    $('#join-looking').addClass('hidden');

    if (chatsToJoin.length > 0) {
      $('#join-loading').addClass('hidden');
      $('#join-form').removeClass('hidden');
      const $select = $('#chat-urls');
      $select.empty();

      chatsToJoin.forEach(game => {
        let name = chat.name;

        if (!name) {
          name = chat.chatUrl;
        }

        $select.append($(`<option value="${game.gameUrl}">${name} (${game.opponentsName})</option>`));
      });
    } else {
      $('#no-join').removeClass('hidden');
    }
  } else {
    $('#login-required').modal('show');
  }
});

$('#join-chat-btn').click(async () => {
  if ($('#join-data-url').val() !== userWebId) {
    userDataUrl = $('#join-data-url').val();

    if (await core.writePermission(userDataUrl, dataSync)){
      $('#join-chat-options').addClass('hidden');
      const chatUrl = $('#chat-urls').val();

      let i = 0;

      while (i < chatsToJoin.length && chatsToJoin[i].chatUrl !== chatUrl) {
        i++;
      }

      const chat = chatsToJoin[i];

      // remove it from the array so it's no longer shown in the UI
      chatsToJoin.splice(i, 1);

      // setUpForEveryChatOption();
      // interlocWebId = chat.interlocutorWebId;
      // semanticChat = await core.joinExistingChat(chatUrl, chat.invitationUrl, interlocWebId, userWebId, userDataUrl, dataSync, chat.fileUrl);

        // webrtc = new WebRTC({
          // userWebId,
          // userInboxUrl: await core.getInboxUrl(userWebId),
          // interlocutorWebId: interlocWebId,
          // interlocutorWebId: await core.getInboxUrl(interlocWebId),
          // fetch: auth.fetch,
          // initiator: false,
          // onNewData: rdfjsSource => {
            // let newMessageFound = false;

            // core.checkForNewMessage(semanticChat, dataSync, userDataUrl, rdfjsSource, (san, url) => {
              // semanticChat.loadMessage(san, {url});
              // //semanticChat.getChat().fen()
              // updateStatus();
              // newMessageFound = true;
            // });

            // if (!newMessageFound) {
              // core.checkForGiveUpOfChat(semanticChat, rdfjsSource, (agentUrl, objectUrl) => {
                // semanticChat.loadGiveUpBy(agentUrl);
                // $('#interlocutor-quit').modal('show');
              // });
            // }
          // },
          // onCompletion: () => {
            // $('#real-time-setup').modal('hide');
          // },
          // onClosed: (closedByUser) => {
            // if (!closedByUser && !$('#interlocutor-quit').is(':visible')) {
              // $('#interlocutor-quit').modal('show');
            // }
          // }
        // });

        // webrtc.start();

        // //$('#real-time-setup .modal-body ul').append('<li>Response sent</li><li>Setting up direct connection</li>');
        // //$('#real-time-setup').modal('show');
      

      // setUpWindow(semanticChat);
      // setUpAfterEveryChatOptionIsSetUp();
    } else {
      $('#write-permission-url').text(userDataUrl);
      $('#write-permission').modal('show');
    }
  } else {
    console.warn('We are pretty sure you do not want to remove your WebID.');
  }
});

$('.btn-cancel').click(() => {
  interlocWebId = null;

  $('#chat').addClass('hidden');
  $('#new-chat-options').addClass('hidden');
  $('#join-chat-options').addClass('hidden');
  $('#continue-chat-options').addClass('hidden');
  $('#chat-options').removeClass('hidden');
});
