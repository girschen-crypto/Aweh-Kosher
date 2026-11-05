// Deployment identity comes from Netlify's trusted invocation context, never a request header.
export function tradingRuntime(context,env=process.env){return {...env,
  CONTEXT:context?.deploy?.context||env.CONTEXT,
  TRADEDESK_DEPLOY_ID:context?.deploy?.id||env.DEPLOY_ID,
};}
