import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";
import { User } from "@/db/models/auth/user.model";

export type KycStatus = "pending" | "verified" | "rejected";
export type KycIdType = "id_card" | "passport";

export class KycVerification extends Model {
  declare id: number;
  declare userId: number;
  declare status: KycStatus;
  declare idType: KycIdType;
  declare fullName: string;
  declare idNumber: string;
  declare countryIso: string;
  declare address: string | null;
  declare validUntil: string | null;
  declare docFrontName: string | null;
  declare docBackName: string | null;
  declare rejectReason: string | null;
  declare submittedAt: Date | null;
  declare reviewedAt: Date | null;
  declare createTime: Date;
  declare updateTime: Date;

  declare user?: User;
}

export async function initKycVerificationModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  KycVerification.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: "f_id" },
      userId: { type: DataTypes.BIGINT, field: "f_user_id", allowNull: false },
      status: {
        type: DataTypes.STRING(16),
        field: "f_status",
        allowNull: false,
        defaultValue: "pending",
      },
      idType: { type: DataTypes.STRING(16), field: "f_id_type", allowNull: false },
      fullName: { type: DataTypes.STRING(128), field: "f_full_name", allowNull: false },
      idNumber: { type: DataTypes.STRING(64), field: "f_id_number", allowNull: false },
      countryIso: {
        type: DataTypes.STRING(8),
        field: "f_country_iso",
        allowNull: false,
        defaultValue: "CN",
      },
      address: { type: DataTypes.STRING(255), field: "f_address", allowNull: true },
      validUntil: { type: DataTypes.STRING(32), field: "f_valid_until", allowNull: true },
      docFrontName: { type: DataTypes.STRING(255), field: "f_doc_front_name", allowNull: true },
      docBackName: { type: DataTypes.STRING(255), field: "f_doc_back_name", allowNull: true },
      rejectReason: { type: DataTypes.STRING(255), field: "f_reject_reason", allowNull: true },
      submittedAt: { type: DataTypes.DATE, field: "f_submitted_at", allowNull: true },
      reviewedAt: { type: DataTypes.DATE, field: "f_reviewed_at", allowNull: true },
      createTime: {
        type: DataTypes.DATE,
        field: "f_create_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updateTime: {
        type: DataTypes.DATE,
        field: "f_update_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "KycVerification",
      tableName: "t_kyc_verification",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );

  KycVerification.belongsTo(User, { foreignKey: "userId", as: "user" });
}
