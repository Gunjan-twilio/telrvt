
//const libphonenumber = require("libphonenumber-js/max");

/**
 * public twilio function exposed on the /telerivet path.
 * used as webhook from Telerivet when the  Android phone recieves an incoming call. 
 * Decides what happens based off callers item in sync.
 * @param {*} context
 * @param {*} event
 * @param {*} callback
 */

exports.handler = async function (context, event, callback) {
  try {
    let client = context.getTwilioClient();

    let fromNumber = event["to_number"]; //telervit, (number user called)
    let toNumber = event["from_number"]; //telerivet (number that called into telerivt)
    let secret = event["secret"];

    //validate it is a telerivet good request
    if (!secret || secret.toUpperCase() !== context.TELERIVET_SECRET) {
      let response = new Twilio.Response();
      response.setStatusCode(401);
      callback(null, response);
      return;
    }
    //you can do other processing here e.g., text the end user etc.
    const execution = await client.studio
      .flows(context.IVR_FLOW_SID)
      .executions
      .create({
        to: toNumber,
        from: fromNumber
      });
    //let telerivet know  
    let response = new Twilio.Response();
    response.setStatusCode(200);
    callback(null, response);
  }
  catch (err) {
    console.error(err);
    callback(err);
  }
};

