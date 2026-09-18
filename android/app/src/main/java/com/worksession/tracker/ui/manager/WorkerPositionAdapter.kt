package com.worksession.tracker.ui.manager

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.worksession.tracker.R
import com.worksession.tracker.data.models.WorkerPosition
import com.worksession.tracker.utils.toRelativeTime

class WorkerPositionAdapter :
    ListAdapter<WorkerPosition, WorkerPositionAdapter.ViewHolder>(DIFF) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_worker, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) =
        holder.bind(getItem(position))

    inner class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {

        private val tvName:        TextView = itemView.findViewById(R.id.tvWorkerName)
        private val tvTeam:        TextView = itemView.findViewById(R.id.tvWorkerTeam)
        private val tvLastUpdate:  TextView = itemView.findViewById(R.id.tvLastUpdate)
        private val tvStatusBadge: TextView = itemView.findViewById(R.id.tvStatusBadge)
        private val tvAvatar:      TextView? = itemView.findViewById(R.id.tvAvatarInitials)

        fun bind(item: WorkerPosition) {
            val name = item.displayWorkerName
            tvName.text       = name
            tvTeam.text       = item.displayTeam
            tvLastUpdate.text = item.displayTime?.toRelativeTime() ?: "Recent"

            tvAvatar?.text = name.firstOrNull()?.uppercase() ?: "W"

            val status = item.calculatedStatus
            tvStatusBadge.text = "● " + status.uppercase()

            when (status) {
                "live" -> {
                    tvStatusBadge.setBackgroundResource(R.drawable.bg_badge_live)
                    tvStatusBadge.setTextColor(itemView.context.getColor(R.color.status_live))
                }
                "stale" -> {
                    tvStatusBadge.setBackgroundResource(R.drawable.bg_badge_stale)
                    tvStatusBadge.setTextColor(itemView.context.getColor(R.color.status_stale))
                }
                else -> {
                    tvStatusBadge.setBackgroundResource(R.drawable.bg_badge_offline)
                    tvStatusBadge.setTextColor(itemView.context.getColor(R.color.status_offline))
                }
            }
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<WorkerPosition>() {
            override fun areItemsTheSame(a: WorkerPosition, b: WorkerPosition) =
                a.workerId == b.workerId
            override fun areContentsTheSame(a: WorkerPosition, b: WorkerPosition) = a == b
        }
    }
}