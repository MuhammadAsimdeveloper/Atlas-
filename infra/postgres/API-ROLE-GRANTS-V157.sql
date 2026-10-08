-- V157 API grants for knowledge metadata. Workers never read knowledge tables directly.
BEGIN;
GRANT SELECT,INSERT,UPDATE,DELETE ON atlas_v157_knowledge_stores,atlas_v157_knowledge_documents,atlas_v157_knowledge_chunks,atlas_v157_knowledge_retrieval_policies TO atlas_app;
COMMIT;
