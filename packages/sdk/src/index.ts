export { withTrace2Test, buildCapture, fromLambdaEvent } from './lambda.js';
export { trace2testExpress, type ExpressLikeRequest, type ExpressLikeResponse } from './express.js';
export { trace2testFastify, type FastifyLikeInstance, type FastifyLikeReply, type FastifyLikeRequest } from './fastify.js';
export { REPLAY_HEADER, captureFrom, isReplay, report, type RequestInfo, type ResponseInfo, type Trace2TestConfig } from './core.js';
// A handler that answers its own 500 can still pass the error to the capture.
export { serverError } from '@t2t/shared';
export type { Capture, HttpEvent, PatternName } from '@t2t/shared';
