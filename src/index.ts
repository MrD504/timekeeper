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

    await handleMessageToUser(channel, `Processing request, I will tell you when I am finished`);

    if (text.indexOf("join") !== -1) {
      try {
        //check if user exists
        const userInfo = await getUser(email);
        if (userInfo.empty) {
          await createUser(email);
          await handleMessageToUser(channel, `${display_name} has joined timekeeping`);
        } else {
          await handleMessageToUser(channel, `${display_name} already exists in database`)
        }
      } catch (err) {
        throw new functions.https.HttpsError('unknown', err.message, err);
      }
    }

    if (text.indexOf("clock-in") !== -1) {
      try {
        const userInfo = await getUser(email);
        if (userInfo.empty) {
          await handleMessageToUser(channel, `${display_name} does not exist in database please type @timekeeper join`);
          return;
        }

        userInfo.docs.forEach(async (item) => {
          const msg = await handleClockingIn(item.id);
          await handleMessageToUser(channel, msg)
        })
      } catch (err) {
        // const messageToUser =
        throw new functions.https.HttpsError('unknown', err.message, err);
      }
    }

    if (text.indexOf("clock-out") !== -1) {
      try {
        const userInfo = await getUser(email);
        if (userInfo.empty) {
          await handleMessageToUser(channel, `${display_name} does not exist in database please type @timekeeper join`);
          return;
        }

        userInfo.docs.forEach(async (item) => {
          const msg = await handleClockingOut(item.id);
          await handleMessageToUser(channel, msg)
        })
      } catch (err) {
        // const messageToUser =
        throw new functions.https.HttpsError('unknown', err.message, err);
      }
    }

    if (text.indexOf("hours-today") !== -1) {
      const userInfo = await getUser(email);
      userInfo.docs.forEach(async (item) => {
        const matchingDate = await db.collection('datesWorked').where('userId', '==', item.id).where('date', '==', new Date().toDateString()).get();
        if (matchingDate.empty) {
          await handleMessageToUser(channel, `${display_name} has been a lazy bum today`)
        } else {
          matchingDate.docs.forEach(async (dayWorked) => {
            const data = dayWorked.data();
            await handleMessageToUser(channel, `${display_name} ${data.date}, ${data.start} - ${data.end}`)
          })
        }
      })
    }

  });

async function handleClockingIn(userId: string) {

  // get user id
  try {

    // docs are defined
    const responseMessage: any = await handleCreateDate(userId);
    return responseMessage;

  } catch (err) {
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
};

async function handleClockingOut(userId: string) {
  try {
    // find date
    const results = await db.collection('datesWorked').where('userId', '==', userId).where('date', '==', new Date().toDateString()).where('end', '==', '').get();

    if (!results.empty) {
      results.docs.forEach(async (result) => {
        await db.collection('datesWorked').doc(result.id).update({
          end: new Date().toLocaleTimeString()
        })
      })
      return `clocked out`
    } else {
      return 'Already clocked out'
    }

  } catch (err) {
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
};

async function getUser(email: string) {
  return db.collection('user').where('email', '==', email).get();
};

async function createUser(email: string) {
  return db.collection('user').add({
    email: email
  })
}

async function handleMessageToUser(channel: string, message: string) {
  await bot.chat.postMessage({ channel: channel, text: message })
  return;
};

async function handleCreateDate(userId: string) {
  // get matching date for today if it exists
  const matchingDate = await db.collection('datesWorked').where('userId', '==', userId).where('date', '==', new Date().toDateString()).get();

  // if todays date does not exist in collection add it
  if (matchingDate.empty) {
    const message = await addDateToCollection(userId);
    return message;
  } else {
    return 'Already clocked in'
  }
};

async function addDateToCollection(userId: string): Promise<any> {
  const workDate = new Date().toDateString();
  const startTime = new Date().toLocaleTimeString()
  await db.collection('datesWorked').add({
    userId: userId,
    date: workDate,
    end: '',
    start: startTime,
  });

  return `Clocked in on ${workDate} at ${startTime}`;
}