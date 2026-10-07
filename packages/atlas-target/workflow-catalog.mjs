const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

// Canonical event names used by CRM, communication, commerce, education,
// scheduling, provider webhooks and the Atlas agent runtime. Keep this list
// vendor-neutral; provider adapters map verified external events into it.
export const WORKFLOW_TRIGGER_TYPES = deepFreeze([
  'contact.created', 'contact.updated', 'contact.tag_added', 'contact.tag_removed', 'contact.dnd_changed',
  'contact.note_added', 'contact.note_changed', 'contact.engagement_threshold', 'contact.birthday_due', 'contact.custom_date_due', 'contact.phone_validation_completed',
  'lead.score_changed', 'prospect.generated', 'form.submitted', 'survey.submitted', 'quiz.submitted',
  'trigger_link.clicked', 'funnel.page_viewed', 'tracking.external_event', 'video.threshold_reached',
  'lead_form.facebook_submitted', 'lead_form.instagram_submitted', 'lead_form.tiktok_submitted', 'lead_form.linkedin_submitted', 'lead_form.google_submitted',
  'appointment.booked', 'appointment.confirmed', 'appointment.rescheduled', 'appointment.canceled', 'appointment.no_show',
  'appointment.completed', 'appointment.reminder_due', 'appointment.service_booked', 'rental.booked',
  'opportunity.created', 'opportunity.updated', 'opportunity.stage_changed', 'opportunity.status_changed', 'opportunity.stale',
  'affiliate.created', 'affiliate.sale', 'affiliate.campaign_enrolled', 'affiliate.lead_created',
  'course.signup', 'course.category_started', 'course.category_completed', 'course.lesson_started', 'course.lesson_completed',
  'course.product_started', 'course.product_completed', 'course.access_granted', 'course.access_removed', 'course.user_login',
  'community.group_access_granted', 'community.group_access_revoked', 'community.private_channel_granted',
  'community.private_channel_revoked', 'community.level_changed', 'certificate.issued',
  'invoice.created', 'invoice.sent', 'invoice.due', 'invoice.overdue', 'invoice.paid',
  'payment.received', 'payment.failed', 'payment.refunded', 'order.form_submitted', 'order.submitted',
  'document.sent', 'document.signed', 'document.declined', 'estimate.sent', 'estimate.accepted', 'estimate.declined',
  'subscription.created', 'subscription.updated', 'subscription.paused', 'subscription.resumed', 'subscription.canceled',
  'coupon.applied', 'coupon.redeemed', 'coupon.limit_reached', 'coupon.expired',
  'store.order_placed', 'store.order_fulfilled', 'store.checkout_abandoned', 'store.product_review_submitted',
  'store.shopify_abandoned_cart', 'store.shopify_order_placed', 'store.shopify_order_fulfilled',
  'ivr.started', 'ivr.input_received', 'social.facebook_comment', 'social.instagram_comment', 'social.tiktok_comment', 'social.click_to_whatsapp_started',
  'review.received', 'call.started', 'call.answered', 'call.missed', 'call.ended', 'call.details_matched', 'call.transcript_generated',
  'message.received', 'message.delivery_failed', 'message.sms_error', 'message.customer_replied',
  'conversation.ai_triggered', 'conversation.handed_off',
  'email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.spam_complaint', 'email.spam', 'email.unsubscribed',
  'consent.granted', 'consent.revoked', 'task.created', 'task.completed', 'task.reminder_due',
  'agent.started', 'agent.tool_approval_requested', 'agent.needs_human', 'agent.resolved', 'agent.failed', 'agent.evaluation.completed',
  'workflow.completed', 'workflow.failed', 'workflow.called', 'schedule.fired', 'webhook.received', 'custom.event'
]);

const eventFamily = type => {
  if (type.startsWith('contact.') || type.startsWith('lead.') || type.startsWith('prospect.') || type.startsWith('task.')) return 'crm';
  if (type.startsWith('appointment.') || type.startsWith('rental.')) return 'booking';
  if (type.startsWith('opportunity.')) return 'sales';
  if (type.startsWith('payment.') || type.startsWith('invoice.') || type.startsWith('order.') || type.startsWith('subscription.') || type.startsWith('coupon.') || type.startsWith('estimate.') || type.startsWith('document.')) return 'commerce';
  if (type.startsWith('course.') || type.startsWith('community.') || type.startsWith('certificate.')) return 'education';
  if (type.startsWith('social.') || type.startsWith('lead_form.') || type.startsWith('funnel.') || type.startsWith('tracking.') || type.startsWith('video.') || type.startsWith('review.')) return 'marketing';
  if (type.startsWith('call.') || type.startsWith('ivr.')) return 'voice';
  if (type.startsWith('message.') || type.startsWith('conversation.') || type.startsWith('email.')) return 'communications';
  if (type.startsWith('agent.')) return 'ai';
  if (type.startsWith('workflow.') || type.startsWith('schedule.') || type.startsWith('webhook.') || type.startsWith('custom.')) return 'orchestration';
  return 'events';
};

export const WORKFLOW_TRIGGER_CATALOG = deepFreeze(Object.fromEntries(WORKFLOW_TRIGGER_TYPES.map(type => [type, {
  type,
  family: eventFamily(type),
  trust: type === 'custom.event' ? 'trusted-internal-only' : ['webhook.received', 'tracking.external_event'].includes(type) ? 'verified-adapter-required' : 'tenant-event',
  idempotency: 'tenant-provider-event',
  payloadPolicy: 'references-and-allowlisted-fields'
}])));

const definitions = [
  ['trigger','orchestration','read',null,'native',false],
  ['condition','orchestration','read',null,'native',false], ['switch','orchestration','read',null,'native',false], ['goal','orchestration','read',null,'native',false], ['random_split','orchestration','read','stable_tenant_cohort','native',false],
  ['delay','orchestration','read',null,'native',false], ['wait_until','orchestration','read',null,'native',false], ['await_event','orchestration','read','tenant_event_and_deadline','native',false], ['rate_limit_batch','orchestration','read','tenant_quota_and_bounded_rate','native',false],
  ['transform','data','read','declarative_mapping_only','native',false], ['map_array','data','read','bounded_array_mapping','native',false], ['filter_array','data','read','bounded_array_filter','native',false], ['split_batches','orchestration','read','bounded_batch_size','native',false], ['merge','data','read','declared_merge_strategy','native',false], ['text_format','data','read','bounded_transform','native',false], ['math','data','read','finite_numeric_inputs','native',false], ['set_custom_value','data','write','tenant_config_and_version','connector',false],
  ['find_contact','crm','read','tenant_search_scope','connector',false], ['create_contact','crm','write','tenant_crm_create_and_dedupe','connector',false], ['copy_contact','crm','write','same_tenant_copy_only_and_idempotency','connector',false], ['delete_contact','crm','destructive','tenant_record_version_and_human_approval','connector',true], ['set_field','crm','write','tenant_record_version_and_idempotency','connector',false], ['tag','crm','write','tenant_record_and_idempotency','connector',false], ['assign_contact','crm','write','tenant_member_and_version','connector',false], ['remove_contact_assignment','crm','write','tenant_member_and_version','connector',false], ['manage_contact_followers','crm','write','tenant_membership_and_idempotency','connector',false], ['update_engagement_score','crm','write','tenant_record_and_idempotency','connector',false], ['set_contact_dnd','crm','write','fresh_channel_consent_policy','connector',false], ['add_note','crm','write','tenant_record_and_idempotency','connector',false], ['create_task','crm','write','tenant_task_and_idempotency','connector',false], ['edit_conversation','communications','write','tenant_conversation_and_version','connector',false], ['create_opportunity','sales','write','tenant_pipeline_and_idempotency','connector',false], ['update_opportunity','sales','write','tenant_deal_version_and_idempotency','connector',false], ['remove_opportunity','sales','destructive','tenant_deal_idempotency_and_approval','connector',true],
  ['associate','crm','write','tenant_scope','connector',false], ['find_availability','booking','network','fresh_calendar_read','connector',false], ['book_appointment','booking','write','fresh_availability_and_idempotency','connector',false], ['generate_booking_link','booking','write','tenant_calendar_and_single_use','connector',false], ['reschedule_appointment','booking','write','calendar_availability_and_version','connector',false], ['cancel_appointment','booking','destructive','tenant_and_version','connector',true], ['update_appointment_status','booking','write','tenant_appointment_and_transition','connector',false],
  ['send_message','communications','network','fresh_message_policy_template_and_delivery_idempotency','connector',false], ['reply_in_conversation','communications','network','fresh_message_policy_conversation_and_delivery_idempotency','connector',false], ['reply_social_comment','marketing','network','platform_grant_content_policy_and_review','connector',true], ['notify_internal','communications','network','tenant_recipient_channel_and_idempotency','connector',false], ['send_review_request','marketing','network','service_event_contact_consent_and_delivery_idempotency','connector',false], ['send_document_contract','commerce','network','signed_document_release_and_recipient_consent','connector',true], ['call_contact','voice','network','voice_consent_and_call_window','connector',true], ['manual_action','crm','write','tenant_assignment_and_idempotency','connector',false],
  ['webhook','integrations','network','signed_allowlisted_endpoint_reference','connector',false], ['http_request','integrations','network','scoped_connector_operation','connector',false], ['spreadsheet_upsert','integrations','network','scoped_connector_and_idempotency','connector',false],
  ['invoke_agent','ai','ai','agent_release_and_capability_gate','agent-runtime',false], ['ai_generate','ai','ai','tenant_model_policy_and_output_guardrails','model-runtime',false], ['ai_classify','ai','ai','tenant_model_policy_and_output_schema','model-runtime',false], ['ai_summarize','ai','ai','tenant_model_policy_and_content_scope','model-runtime',false], ['ai_intent_detect','ai','ai','tenant_model_policy_and_label_set','model-runtime',false], ['knowledge_search','ai','read','tenant_knowledge_scope','retrieval',false],
  ['create_payment_link','finance','financial','provider_tokenization_spend_policy_and_idempotency','connector',true], ['charge_payment','finance','financial','tokenized_payment_method_spend_policy_step_up_and_idempotency','connector',true], ['send_invoice','finance','financial','invoice_authority_and_idempotency','connector',true], ['issue_refund','finance','financial','step_up_dual_control_idempotency_and_reconciliation','connector',true],
  ['publish_social_post','marketing','network','scoped_social_grant_and_review','connector',true], ['add_to_audience','marketing','write','advertising_consent_and_scoped_grant','connector',true], ['remove_from_audience','marketing','write','scoped_grant_and_idempotency','connector',false], ['record_conversion','marketing','network','consent_and_attribution_policy','connector',false], ['send_analytics_event','marketing','network','tenant_attribution_consent_and_scoped_grant','connector',false],
  ['affiliate_action','commerce','write','tenant_affiliate_and_idempotency','connector',false], ['update_affiliate','commerce','write','tenant_affiliate_version_and_idempotency','connector',false], ['manage_affiliate_campaign','commerce','write','tenant_campaign_and_affiliate_consent','connector',false], ['grant_course_access','education','write','tenant_entitlement_and_payment_state','connector',false], ['revoke_course_access','education','destructive','tenant_entitlement_and_approval','connector',true], ['set_community_access','education','write','tenant_group_and_entitlement','connector',false], ['add_google_ads_audience','marketing','network','scoped_ads_grant_and_consent','connector',true], ['remove_google_ads_audience','marketing','network','scoped_ads_grant_and_idempotency','connector',false], ['facebook_conversion_event','marketing','network','consent_and_attribution_policy','connector',false],
  ['ivr_gather_input','voice','network','call_session_and_consent','connector',false], ['ivr_play_message','voice','network','call_session_and_approved_content','connector',false], ['ivr_transfer_call','voice','network','eligible_route_and_transfer_budget','connector',true], ['ivr_connect_call','voice','network','eligible_route_and_transfer_budget','connector',true], ['ivr_end_call','voice','network','active_tenant_call_session','connector',false], ['record_voicemail','voice','network','explicit_recording_consent_and_retention','connector',true],
  ['approval','governance','write','exact_action_bound_human_approval','native',true], ['sub_workflow','orchestration','write','same_tenant_pinned_child_release','native',false], ['remove_from_workflow','orchestration','write','tenant_enrollment_and_idempotency','connector',false], ['loop_over_items','orchestration','read','max_items_and_iterations','native',false], ['aggregate','data','read','bounded_inputs','native',false], ['remove_duplicates','data','read','bounded_keyset','native',false], ['sort','data','read','bounded_fields_and_items','native',false], ['split_out','data','read','bounded_array_expansion','native',false], ['edit_fields','data','read','allowlisted_data_mapping','native',false], ['respond_to_webhook','integrations','network','bounded_reference_response','connector',false], ['error_trigger','orchestration','read','reference_only_error_context','native',false], ['stop_and_error','orchestration','read','bounded_error_code','native',false], ['no_op','orchestration','read',null,'native',false], ['data_table','data','read','tenant_table_scope','connector',false], ['execution_data','orchestration','read','redacted_custom_data','native',false], ['mcp_client','ai','network','capability_and_approval_bound','connector',true], ['mcp_server_trigger','ai','network','authenticated_tool_catalog','connector',true], ['code_transform','data','read','declarative_expression_only','native',false], ['execute_subworkflow','orchestration','write','same_tenant_pinned_child_release','native',false], ['chat_trigger','communications','read','tenant_chat_scope','connector',false], ['schedule_trigger','orchestration','read','tenant_schedule_scope','native',false], ['form_trigger','marketing','read','tenant_form_scope','connector',false], ['evaluation_trigger','ai','read','signed_evaluation_scope','native',false], ['guardrails','ai','read','bounded_policy_guard','native',false], ['stop','orchestration','read',null,'native',false],
  ['connector_action','integrations','network','scoped_connector_operation_and_credential_ref','connector',false],
  ['connector_trigger','integrations','network','verified_connector_event_and_dedupe','connector',false],
  ['webhook_trigger','integrations','network','signed_webhook_verification_and_replay_window','connector',false],
  ['webhook_response','integrations','network','bounded_reference_response','connector',false],
  ['graphql_request','integrations','network','scoped_connector_graphql_operation','connector',false],
  ['soap_request','integrations','network','scoped_connector_soap_operation','connector',false],
  ['oauth2','integrations','network','oauth_connection_ref_and_scope_allowlist','connector',false],
  ['basic_auth','integrations','network','credential_ref_only','connector',false],
  ['bearer_auth','integrations','network','credential_ref_only','connector',false],
  ['hmac_auth','integrations','network','credential_ref_and_signed_request','connector',false],
  ['custom_headers','integrations','network','allowlisted_non_secret_headers','connector',false],
  ['pagination','integrations','read','bounded_cursor_or_page_strategy','connector',false],
  ['retry','orchestration','read','bounded_attempts_exponential_backoff','native',false],
  ['circuit_breaker','orchestration','read','tenant_provider_failure_budget','native',false],
  ['batch','orchestration','read','bounded_batch_size','native',false],
  ['loop','orchestration','read','bounded_iterations_and_items','native',false],
  ['split_in_batches','orchestration','read','bounded_batch_size','native',false],
  ['parallel','orchestration','read','bounded_branch_concurrency','native',false],
  ['router','orchestration','read','bounded_route_count','native',false],
  ['error_branch','orchestration','read','reference_only_error_context','native',false],
  ['dead_letter','orchestration','write','tenant_execution_and_repair_policy','native',false],
  ['replay_execution','orchestration','write','tenant_version_pinned_replay_and_idempotency','native',false],
  ['resume_execution','orchestration','write','lease_bound_resume_and_version_pin','native',false],
  ['execution_snapshot','orchestration','read','redacted_snapshot_payload','native',false],
  ['workflow_diff','governance','read','tenant_version_diff','native',false],
  ['workflow_promote','governance','write','protected_environment_and_manifest_match','native',true],
  ['workflow_rollback','governance','write','protected_environment_and_version_pin','native',true],
  ['workflow_as_tool','ai','network','same_tenant_pinned_workflow_release','native',false],
  ['workflow_as_agent_tool','ai','network','same_tenant_agent_capability_gate','agent-runtime',true],
  ['credential_ref','integrations','read','opaque_tenant_credential_reference','connector',false],
  ['kv_get','data','read','tenant_key_scope_and_size_limit','native',false],
  ['kv_set','data','write','tenant_key_scope_and_size_limit','native',false],
  ['json_parse','data','read','bounded_input_and_output','native',false],
  ['csv_parse','data','read','bounded_rows_and_columns','native',false],
  ['xml_parse','data','read','bounded_document_and_allowlist','native',false],
  ['sql_query','data','network','named_database_connection_and_read_policy','connector',false],
  ['javascript_sandbox','data','read','isolated_sandbox_no_host_network_or_secrets','connector',false],
  ['python_sandbox','data','read','isolated_sandbox_no_host_network_or_secrets','connector',false]
];

export const WORKFLOW_NODE_CATALOG = deepFreeze(Object.fromEntries(definitions.map(([type, category, risk, guard, execution, requiresApproval]) => [type, {
  type, category, risk, guard, execution, requiresApproval,
  retrySafe: ['native','agent-runtime','model-runtime','retrieval'].includes(execution) || risk === 'read' || /idempotency|stable_request_key/.test(guard || ''),
  requiresAdapter: ['connector','agent-runtime','model-runtime','retrieval'].includes(execution)
}])));

export const WORKFLOW_NODE_TYPES = Object.freeze(Object.keys(WORKFLOW_NODE_CATALOG));

