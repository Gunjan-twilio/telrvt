exports.handler = function (context, event, callback) {
  let secret = event.secret;
  if (secret !== context.TELERIVET_SMS_SECRET) {
    callback("The token does not match")
  } else {
    let response = new Twilio.Response();
    response.setStatusCode(200);
    response.setBody('everything is okay');
    callback(null, response);
  }
};
