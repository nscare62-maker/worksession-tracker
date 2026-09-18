package com.worksession.tracker.ui.worker

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.worksession.tracker.R
import com.worksession.tracker.data.models.Task

class TaskAdapter(
    private val onStart: (Task) -> Unit,
    private val onComplete: (Task) -> Unit
) : ListAdapter<Task, TaskAdapter.TaskViewHolder>(DIFF_CALLBACK) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TaskViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_task, parent, false)
        return TaskViewHolder(view)
    }

    override fun onBindViewHolder(holder: TaskViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class TaskViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {

        private val tvTitle: TextView           = itemView.findViewById(R.id.tvTaskTitle)
        private val tvStatus: TextView          = itemView.findViewById(R.id.tvTaskStatus)
        private val tvDesc: TextView            = itemView.findViewById(R.id.tvTaskDescription)
        private val btnStart: MaterialButton    = itemView.findViewById(R.id.btnStartTask)
        private val btnComplete: MaterialButton = itemView.findViewById(R.id.btnCompleteTask)

        fun bind(task: Task) {
            tvTitle.text = task.title ?: "Task"
            val status = (task.status ?: "assigned").lowercase()
            tvDesc.text = task.description ?: ""
            tvDesc.visibility = if (task.description.isNullOrBlank()) View.GONE else View.VISIBLE

            val isPending = status in listOf("pending", "assigned")
            btnStart.visibility    = if (isPending) View.VISIBLE else View.GONE
            btnComplete.visibility = if (status == "in_progress") View.VISIBLE else View.GONE

            btnStart.setOnClickListener    { onStart(task) }
            btnComplete.setOnClickListener { onComplete(task) }

            when (status) {
                "completed" -> {
                    tvStatus.text = "● DONE"
                    tvStatus.setBackgroundResource(R.drawable.bg_badge_live)
                    tvStatus.setTextColor(itemView.context.getColor(R.color.status_live))
                }
                "in_progress" -> {
                    tvStatus.text = "● IN PROGRESS"
                    tvStatus.setBackgroundResource(R.drawable.bg_badge_stale)
                    tvStatus.setTextColor(itemView.context.getColor(R.color.status_stale))
                }
                else -> {
                    tvStatus.text = "● ASSIGNED"
                    tvStatus.setBackgroundResource(R.drawable.bg_stat_chip)
                    tvStatus.setTextColor(itemView.context.getColor(R.color.primary))
                }
            }
        }
    }

    companion object {
        private val DIFF_CALLBACK = object : DiffUtil.ItemCallback<Task>() {
            override fun areItemsTheSame(a: Task, b: Task) = a.id == b.id
            override fun areContentsTheSame(a: Task, b: Task) = a == b
        }
    }
}