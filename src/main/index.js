"use strict";

const Core = require('../lib/core');
const auth = require('solid-auth-client');
const { default: data } = require('@solid/query-ldflex');
const namespaces = require('../lib/namespaces');
const DataSync = require('../lib/datasync');

let core = new Core(auth.fetch);
let userWebId;
let interlocutorWebId;
let refreshIntervalId;
let dataSync = new DataSync(auth.fetch);
let userDataUrl;

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
    interlocutorWebId = $('#contacts').val();
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
