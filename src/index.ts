import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

import { WebClient } from '@slack/web-api';
const bot = new WebClient(functions.config().slack.token);

const { PubSub } = require('@google-cloud/pubsub');
const pubsubClient = new PubSub();

admin.initializeApp();
const db = admin.firestore();

export const myBot = functions.https.onRequest(async (req, res) => {

  const data = JSON.stringify(req.body);
  const dataBuffer = Buffer.from(data);

  await pubsubClient.topic('manage-timesheet').publish(dataBuffer);
  res.sendStatus(200);

  // when first setting up a function you must verify with slack by returning challenge
  // to prove you own it
  // const {challenge} = req.body;
  // res.send({challenge})

});

export const manageTimesheet = functions.pubsub.topic('manage-timesheet')
  .onPublish(async (message, context) => {
    const { event } = message.json;

    const { user, channel, text } = event;
    const userResult = await bot.users.profile.get({ user });
    const { email, display_name } = userResult.profile as any;
    let response: string = '';
    let matched: boolean = false;

    if (!matched && text.indexOf('clocking-in') !== -1) {
      response = `${display_name} clocked in`;
      matched = true;
      // handle preset messages
      const userObj = await getUser(email);
      userObj.docs.forEach(async (doc) => {
        
        const timesWorked = await getTimesWorked(doc.id);
        const timesheetArr:Array<object> = await timesWorked.docs.map(async (timestamp) => {
          const result = await timestamp.data()
          return result;
        })

        await handleMessageToUser(channel, timesheetArr.toString())
        
      })

    }

    if (!matched && text.indexOf('clocking-out') !== -1) {
      response = `${display_name} clocked out`;
      matched = true;
      // handle preset messages
      await handleMessageToUser(channel, response);
    }

    if (!matched) {
      response = `@${display_name} FUCK YOU!... FUCK, YOU!`
      // handle preset messages
      await handleMessageToUser(channel, response);
    }






  });

async function getUser(email: string) {
  return db.collection('user').where('email', '==', email).get();
};

async function getTimesWorked(id: string) {
  return db.collection('datesWorked').where('userId', '==', id).get();
}

async function handleMessageToUser(channel: string, message: string) {
  await bot.chat.postMessage({ channel: channel, text: message })
  return;
};
