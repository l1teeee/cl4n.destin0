ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_key_chk";--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_key_chk" CHECK ("message_templates"."key" IN ('REQUEST_RECEIVED', 'WAITLISTED', 'PROMOTED', 'ON_LIST', 'PAID', 'REJECTED', 'CANCELLED_UNPAID', 'CANCELLED_PAID', 'REFUNDED', 'LOCATION', 'TAB'));
--> statement-breakpoint
INSERT INTO "message_templates" ("key", "body")
VALUES ('TAB', E'Hola {nombre}, esta es tu cuenta de consumos de la experiencia del {fecha}:\n\n{consumos}\n\nTotal a pagar: {total}\n\n{datos_pago}\n\nCuando transfieras, envíanos el comprobante por aquí. ¡Gracias!')
ON CONFLICT ("key") DO NOTHING;