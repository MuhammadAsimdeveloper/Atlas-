const freeze = value => Object.freeze(value);

export const STATUS = Object.freeze({
  CONTRACT: 'contract',
  BUILD: 'build',
  DEPLOYMENT: 'deployment',
});

const sections = [
  ['GHL','CRM','V111','packages/atlas-target/index.mjs',[
    'contacts','contact_creation','contact_editing','contact_deletion','contact_import','contact_export','tags','custom_fields','custom_values',
    'smart_lists','advanced_filters','bulk_actions','contact_notes','followers','tasks','recurring_tasks','contact_associations','businesses',
    'companies','custom_objects','object_relationships','opportunities','pipelines','pipeline_stages','opportunity_value','opportunity_status',
    'opportunity_assignment','opportunity_bulk_import','opportunity_automation','lead_scoring','attribution_reporting','customer_timelines',
    'crm_dashboards','crm_apis','crm_webhooks'
  ]],
  ['GHL','Conversations & Phone','V112','packages/customer-operations/index.mjs',[
    'unified_inbox','email_conversations','sms','mms','whatsapp','facebook_messenger','instagram_dm','live_chat','website_chat_widget',
    'custom_conversation_providers','conversation_assignment','conversation_tags','conversation_internal_notes','message_templates','text_snippets',
    'scheduled_messages','bulk_sms','bulk_email','two_way_messaging','inbound_calling','outbound_calling','call_recording','call_reporting',
    'call_forwarding','call_tracking','number_pools','caller_id','spam_detection','sms_validation','missed_call_automation','ringless_voicemail',
    'automated_call_connect','ivr','voice_ai','conversation_ai','ai_qualification','ai_appointment_booking','ai_conversation_routing',
    'human_handoff','custom_channel_webhooks'
  ]],
  ['GHL','Marketing','V112','apps/marketing-site/index.html',[
    'email_marketing','email_campaigns','email_broadcasts','email_templates','drag_drop_email_builder','sms_campaigns','whatsapp_campaigns',
    'messenger_campaigns','segmentation','trigger_links','url_shorteners','forms','surveys','quizzes','lead_forms','funnel_pages','website_pages',
    'blog_publishing','blog_authors','blog_categories','content_scheduling','social_planner','social_approval','social_drafts',
    'recurring_social_posts','social_analytics','facebook_publishing','instagram_publishing','linkedin_publishing','tiktok_publishing',
    'youtube_publishing','pinterest_publishing','google_business_profile_publishing','threads_publishing','bluesky_publishing','ad_manager',
    'google_ads','meta_ads','linkedin_ads','prospecting_tool','marketing_audit_reports','content_ai','image_ai','email_ai','funnel_website_ai',
    'seo_assistance','split_testing'
  ]],
  ['GHL','Website, Funnels & SEO','V105','packages/atlas-next/index.mjs',[
    'funnel_builder','website_builder','drag_drop_editor','responsive_editing','page_templates','sections','rows','columns','custom_css',
    'custom_javascript','custom_html','forms_in_pages','surveys_in_pages','calendars_in_pages','checkout_pages','thank_you_pages',
    'domain_connection','ssl','redirects','site_publishing','funnel_analytics','page_analytics','seo_metadata','title_tags','meta_descriptions',
    'canonical_urls','robots_controls','sitemap','schema_markup','open_graph','twitter_cards','seo_ai','split_testing'
  ]],
  ['GHL','Calendars & Scheduling','V111','packages/atlas-target/index.mjs',[
    'calendars','calendar_groups','appointment_types','availability_rules','working_hours','calendar_assignment','round_robin',
    'team_booking','resource_booking','services','service_categories','service_addons','paid_calendars','appointment_booking_pages',
    'appointment_reminders','appointment_confirmations','appointment_reschedule','appointment_cancellation','no_show_handling',
    'recurring_events','google_calendar_sync','calendar_synchronization','blocking_slots','booking_automation'
  ]],
  ['GHL','Payments & Commerce','V115','packages/atlas-trust/index.mjs',[
    'products','product_prices','product_variations','order_forms','checkout','payment_links','one_time_payments','recurring_payments',
    'subscriptions','invoices','recurring_invoices','estimates','proposals','discounts','coupons','taxes','fees','tips','payment_schedules',
    'dunning','failed_payment_recovery','refunds','receipts','transactions','orders','stripe','paypal','square','nmi','authorize_net','razorpay',
    'ach','sepa','apple_pay','google_pay','bnpl','pos','card_readers','tap_to_pay','text_to_pay','gift_cards','loyalty_programs',
    'ecommerce_storefront','upsells','downsells','one_click_upsells','payment_provider_routing','revenue_ledger','billing_reconciliation'
  ]],
  ['GHL','Reputation','V112','packages/atlas-next/index.mjs',[
    'review_requests','review_request_automation','sms_review_requests','email_review_requests','whatsapp_review_requests','review_link',
    'review_balancing','google_reviews','facebook_reviews','review_monitoring','review_trends','review_sentiment','ai_review_replies',
    'ai_review_summaries','review_widgets','review_filtering','rating_thresholds','review_carousel','review_grid','review_masonry','review_slider',
    'video_testimonials','video_collectors','listing_management','yext_integration'
  ]],
  ['GHL','Courses, Memberships & Community','V115','packages/atlas-product/index.mjs',[
    'courses','lessons','membership_products','membership_offers','access_levels','student_management','certificates','webinars','communities',
    'community_groups','community_posts','community_members','community_moderation','paid_memberships','community_monetization'
  ]],
  ['GHL','Affiliate & Growth','V115','packages/atlas-product/index.mjs',[
    'affiliate_manager','affiliate_tracking','referral_links','referral_attribution','affiliate_postbacks','commission_tracking','loyalty_referrals'
  ]],
  ['GHL','Agency, SaaS & White Label','V116','packages/atlas-product/index.mjs',[
    'agency_account','subaccounts','agency_dashboard','subaccount_creation','subaccount_users','user_management','agency_permissions',
    'location_permissions','granular_permissions','snapshots','snapshot_deployment','snapshot_sharing','snapshot_templates','saas_mode',
    'saas_plans','saas_subscriptions','saas_account_provisioning','saas_billing','phone_rebilling','email_rebilling','ai_rebilling',
    'usage_based_billing','markup_billing','white_label_branding','custom_domains','branded_desktop_app','branded_mobile_app',
    'mobile_companion','marketplace','app_installation','reselling','agency_template_library','subaccount_transfers','agency_level_billing',
    'agency_audit_logs'
  ]],
  ['GHL','AI','V114','packages/atlas-copilot/index.mjs',[
    'ask_ai','crm_ai_assistant','content_ai','image_ai','email_ai','website_ai','funnel_ai','conversation_ai','voice_ai','autonomous_agents',
    'agent_studio','managed_agents','workflow_ai_generation','prompt_optimizer','prompt_testing','voice_testing','knowledge_base',
    'ai_review_replies','ai_review_summaries','ai_customer_qualification','ai_booking','ai_routing','ai_crm_actions','ai_connector_actions'
  ]],
  ['GHL','Workflow Automation','V113','packages/atlas-target/index.mjs',[
    'event_triggers','contact_created_trigger','contact_changed_trigger','birthday_trigger','appointment_triggers','opportunity_triggers',
    'payment_triggers','ecommerce_triggers','affiliate_triggers','course_triggers','community_triggers','communication_triggers',
    'google_ads_triggers','social_triggers','ivr_triggers','send_email','send_sms','send_whatsapp','assign_user','create_task','update_contact',
    'add_remove_tag','create_opportunity','update_opportunity','move_pipeline_stage','appointment_action','webhook_trigger','webhook_action',
    'internal_notification','goal_events','if_else','switch_branch','wait','reply_wait','action_wait','condition_wait','appointment_relative_wait',
    'date_wait','recurring_schedule_wait','time_window_wait','workflow_chaining','sub_workflows','ai_workflow_builder'
  ]],

  ['n8n','Core Workflow Runtime','V113','packages/atlas-target/index.mjs',[
    'visual_workflow_canvas','manual_trigger','schedule_trigger','webhook_trigger','app_event_trigger','chat_trigger','sse_trigger',
    'polling_trigger','conditional_branching','if_node','switch_node','merge_node','looping','split_out','aggregate','filter','sort',
    'remove_duplicates','limit_node','wait_node','execute_workflow','sub_workflow','stop_error','no_op','data_mapping','expression_engine',
    'previous_node_data','item_linking','binary_data','file_operations','http_request','graphql','webhooks','jwt','ftp_sftp','ssh','ldap',
    'imap_email','rss','html','markdown','xml','compression','crypto','git','code_node','javascript_execution','python_execution',
    'custom_functions','jmespath','data_tables','mock_execution_data','pinned_execution_data','pagination','workflow_versioning'
  ]],
  ['n8n','Integration Fabric','V113','packages/atlas-next/index.mjs',[
    'rest_api_connectors','graphql_connectors','oauth2_connectors','api_key_connectors','service_account_connectors','hmac_connectors',
    'signed_webhook_connectors','polling_connectors','delta_sync_connectors','event_stream_connectors','connector_sdk','custom_nodes',
    'private_nodes','community_nodes','provider_version_pinning','provider_capability_discovery','provider_health','provider_rate_limits',
    'provider_circuit_breakers','connector_replay_protection','connector_idempotency','connector_deduplication','connector_conflict_resolution'
  ]],
  ['n8n','AI & Agents','V114','packages/atlas-copilot/index.mjs',[
    'ai_agent','conversational_agent','react_agent','tools_agent','plan_execute_agent','sql_agent','llm_chains','basic_chains',
    'information_extraction','text_classification','sentiment_analysis','summarization','structured_output','output_parsers',
    'auto_fixing_parser','ai_memory','simple_memory','redis_memory','postgres_memory','mongodb_memory','zep_memory','vector_stores',
    'pinecone','qdrant','chroma','weaviate','milvus','redis_vector','supabase_vector','pgvector','mongodb_vector','embeddings',
    'document_loaders','text_splitters','retrievers','rerankers','workflow_retriever','vector_retriever','search_tools','calculator_tool',
    'custom_code_tool','mcp_client','mcp_server','workflow_as_tool','human_fallback','human_in_the_loop','model_selector','ai_evaluations',
    'metric_evaluations','light_evaluations','guardrails','agent_observability','agent_cost_tracking','agent_permission_boundaries'
  ]],
  ['n8n','Execution & Queue Runtime','V116','packages/atlas-platform/index.mjs',[
    'execution_history','execution_detail','retry_execution','retry_step','replay_execution','resume_checkpoint','idempotent_execution',
    'at_least_once_execution','deduplication','dead_letter_queue','queues','worker_pool','concurrency_controls','backpressure','priority_queues',
    'scheduled_jobs','cron','long_running_workflows','durable_execution','cancellation','pause_resume','timeouts','rate_limiting',
    'provider_rate_limit_buckets','circuit_breakers','bulkheads','dead_letter_replay','workflow_lineage','execution_audit','data_redaction'
  ]],
  ['n8n','Security & Enterprise','V117','packages/atlas-core/index.mjs',[
    'credential_store','credential_encryption','credential_sharing','least_privilege','workflow_permissions','rbac','custom_roles','projects',
    'user_roles','two_factor_auth','saml','oidc','ldap','external_secrets','audit_logging','log_streaming','security_audit','ssrf_protection',
    'risky_node_controls','community_node_controls','encryption_key_rotation','execution_data_redaction','registration_restrictions',
    'instance_isolation','tenant_isolation','platform_owner_isolation','secret_rotation','key_versioning','tamper_evident_audit','policy_engine'
  ]],
  ['n8n','DevOps & Lifecycle','V118','packages/atlas-platform/index.mjs',[
    'api','api_authentication','cli','git_source_control','development_environment','staging_environment','production_environment',
    'branching','protected_production','push_pull','pr_deployment','workflow_diff','version_history','rollback','node_sdk','node_testing',
    'node_versioning','deployment_promotions','environment_drift_detection','config_validation','release_artifacts','oem_deployment'
  ]],
  ['n8n','Observability & Governance','V119','packages/atlas-platform/index.mjs',[
    'opentelemetry','traces','metrics','logs','slo','error_budgets','burn_rate','workflow_metrics','connector_metrics','queue_metrics',
    'agent_metrics','cost_metrics','security_findings','compliance_evidence','disaster_recovery_evidence','restore_drills','capacity_profiles'
  ]]
];

const CONTRACT_FEATURES = new Set([
  'contacts','companies','custom_objects','contact_associations','opportunities','pipelines','pipeline_stages','opportunity_value','opportunity_status',
  'tasks','notes','custom_fields','custom_objects','customer_timelines',
  'funnel_builder','website_builder','domain_connection','ssl','redirects','site_publishing','seo_metadata','title_tags','meta_descriptions',
  'canonical_urls','robots_controls','sitemap','schema_markup','open_graph','twitter_cards',
  'calendars','availability_rules','working_hours','calendar_assignment','round_robin','resource_booking','appointment_booking_pages',
  'appointment_reschedule','appointment_cancellation','booking_automation',
  'message_templates','send_email','send_sms','send_whatsapp','webhook_trigger','webhook_action','create_task','update_contact','add_remove_tag',
  'create_opportunity','update_opportunity','move_pipeline_stage','appointment_action','if_else','switch_branch','wait','workflow_chaining','sub_workflows',
  'invoices','revenue_ledger','billing_reconciliation',
  'agency_project','granular_permissions',
  'ai_workforce',
]);

const anchorStatus = Object.freeze({
  'packages/atlas-target/index.mjs': STATUS.CONTRACT,
  'packages/atlas-next/index.mjs': STATUS.CONTRACT,
  'packages/atlas-trust/index.mjs': STATUS.CONTRACT,
  'packages/atlas-copilot/index.mjs': STATUS.CONTRACT,
  'packages/customer-operations/index.mjs': STATUS.CONTRACT,
  'packages/atlas-platform/index.mjs': STATUS.CONTRACT,
  'packages/atlas-product/index.mjs': STATUS.BUILD,
  'apps/marketing-site/index.html': STATUS.CONTRACT,
});

const slug = (x) => x.replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toLowerCase();

export const FULL_FEATURE_CATALOG = freeze(sections.flatMap(([benchmark,domain,stage,anchor,features]) =>
  features.map(feature => freeze({
    id: slug(benchmark+'_'+domain+'_'+feature),
    benchmark,
    domain,
    feature,
    stage,
    atlasAnchor: anchor,
    atlasStatus: CONTRACT_FEATURES.has(feature) ? STATUS.CONTRACT : STATUS.BUILD,
    productionBoundary: anchorStatus[anchor] === STATUS.CONTRACT
      ? 'domain-contract: live adapters, infrastructure and external credentials still require deployment verification'
      : 'build: contract must be completed before live deployment',
  }))
));

export const GHL_FEATURES = freeze(FULL_FEATURE_CATALOG.filter(x => x.benchmark === 'GHL'));
export const N8N_FEATURES = freeze(FULL_FEATURE_CATALOG.filter(x => x.benchmark === 'n8n'));

export function assessFullFeatureCoverage({
  catalog = FULL_FEATURE_CATALOG,
  implemented = [],
  deployed = [],
} = {}) {
  if (!Array.isArray(catalog) || !Array.isArray(implemented) || !Array.isArray(deployed)) {
    throw new Error('Coverage inputs invalid');
  }
  const implementedSet = new Set(implemented);
  const deployedSet = new Set(deployed);
  const counts = {
    total: catalog.length,
    contract: catalog.filter(x => x.atlasStatus === STATUS.CONTRACT).length,
    build: catalog.filter(x => x.atlasStatus === STATUS.BUILD).length,
    deployment: catalog.filter(x => x.atlasStatus === STATUS.DEPLOYMENT).length,
    mapped: catalog.filter(x => x.atlasAnchor).length,
    implemented: catalog.filter(x => implementedSet.has(x.id) || implementedSet.has(x.feature)).length,
    deployed: catalog.filter(x => deployedSet.has(x.id) || deployedSet.has(x.feature)).length,
  };
  counts.mappedPercent = Number((counts.mapped / counts.total * 100).toFixed(2));
  counts.implementedPercent = Number((counts.implemented / counts.total * 100).toFixed(2));
  counts.deployedPercent = Number((counts.deployed / counts.total * 100).toFixed(2));
  return {
    ...counts,
    unmapped: catalog.filter(x => !x.atlasAnchor).map(x => x.id),
    notImplemented: catalog.filter(x => !implementedSet.has(x.id) && !implementedSet.has(x.feature)).map(x => x.id),
    notDeployed: catalog.filter(x => !deployedSet.has(x.id) && !deployedSet.has(x.feature)).map(x => x.id),
    stages: Object.fromEntries([...new Set(catalog.map(x => x.stage))].sort().map(stage => [
      stage,
      {
        total: catalog.filter(x => x.stage === stage).length,
        contract: catalog.filter(x => x.stage === stage && x.atlasStatus === STATUS.CONTRACT).length,
        build: catalog.filter(x => x.stage === stage && x.atlasStatus === STATUS.BUILD).length,
        deployment: catalog.filter(x => x.stage === stage && x.atlasStatus === STATUS.DEPLOYMENT).length,
      }
    ])),
  };
}

export function assertFeatureCatalogComplete(catalog = FULL_FEATURE_CATALOG) {
  if (!Array.isArray(catalog) || catalog.length < 300) throw new Error('Full feature catalog unexpectedly small');
  const ids = new Set();
  for (const row of catalog) {
    if (!row.id || ids.has(row.id)) throw new Error('Duplicate or missing feature id: '+row.id);
    ids.add(row.id);
    if (!row.benchmark || !row.domain || !row.feature || !/^V(105|11[1-9]|120)$/.test(row.stage) || !row.atlasAnchor) {
      throw new Error('Feature mapping incomplete: '+JSON.stringify(row));
    }
  }
  return {ok:true,total:catalog.length,ghl:GHL_FEATURES.length,n8n:N8N_FEATURES.length};
}

export const COVERAGE_DEFINITIONS = Object.freeze({
  contract: 'A tested Atlas domain contract exists. This is not a claim of live provider, API, worker, infrastructure or production availability.',
  build: 'A planned implementation anchor exists and is part of V111-V120 engineering work. It is not yet marked complete until tests and release gates prove it.',
  deployment: 'The software contract exists but production rollout, credentials or external service verification remains.',
});

export const NEXT_FRONTIER = Object.freeze([
  'V111 — Complete Business Object and CRM Surface',
  'V112 — Complete Communications, Marketing, Social, Reputation and Ads',
  'V113 — Complete n8n-Class Workflow Runtime and Connector SDK',
  'V114 — AI Workforce, RAG, MCP, Evaluation and Human-in-the-Loop',
  'V115 — Commerce, Courses, Memberships, Affiliate and Revenue Expansion',
  'V116 — Agency, SaaS, White-Label, Durable Worker and API Runtime',
  'V117 — Enterprise Security, IAM, Secrets and Tenant Isolation',
  'V118 — Source Control, Environments, Analytics and Reporting',
  'V119 — OTLP/SLO, DR, Capacity, Compliance Evidence and Operational Governance',
  'V120 — Production Providers, Launch Certification and Verified Scale',
]);
